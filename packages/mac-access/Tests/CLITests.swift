import Foundation
import XCTest
@testable import MacAccessShared

private actor StubCLIClient: MacAccessCLIClient {
    let result: ConnectorCoreResult
    let reply: MacAccessXPCReply?
    private(set) var actions: [ConnectorCoreAction] = []
    private(set) var permissionRequests: [MacAccessPermissionKind] = []

    init(
        result: ConnectorCoreResult = .completed(.connected),
        reply: MacAccessXPCReply? = MacAccessXPCReply(
            code: .ok,
            status: MacAccessXPCSafeStatus(
                pairing: "paired", transport: "connected",
                lastErrorCode: nil, lastAuditID: "redacted-audit-1"
            )
        )
    ) {
        self.result = result
        self.reply = reply
    }

    func perform(_ action: ConnectorCoreAction) -> ConnectorCoreResult {
        actions.append(action)
        return result
    }

    func fetchStatus() -> MacAccessXPCReply? {
        reply
    }

    func requestPermission(_ kind: MacAccessPermissionKind) -> MacAccessXPCReply? {
        permissionRequests.append(kind)
        return reply
    }
}

final class CLITests: XCTestCase {
    func testEntrypointDistinguishesGUIFromCLI() {
        XCTAssertFalse(MacAccessCLI.shouldRun(arguments: []))
        XCTAssertFalse(MacAccessCLI.shouldRun(arguments: ["-psn_0_12345"]))
        XCTAssertTrue(MacAccessCLI.shouldRun(arguments: ["status"]))
        XCTAssertEqual(MacAccessCLI.parse(arguments: ["setup"]), .setup)
    }

    func testSeparateLocalCLIRequestsShareOneAppOwnedClient() async throws {
        let socketPath = "/tmp/evaos-mac-access-test-\(UUID().uuidString).sock"
        let client = StatefulCLIClient()
        let setupRecorder = await MainActor.run { SetupInvocationRecorder() }
        let server = MacAccessLocalControlServer(
            client: client,
            socketPath: socketPath,
            showSetup: { setupRecorder.record() }
        )
        XCTAssertTrue(server.start())
        defer { server.stop() }

        let elevated = try XCTUnwrap(MacAccessLocalControl.request(
            arguments: ["mode", "full", "--json"],
            stdin: Data(),
            socketPath: socketPath
        ))
        XCTAssertEqual(elevated.exitCode, 0)

        let status = try XCTUnwrap(MacAccessLocalControl.request(
            arguments: ["status", "--json"],
            stdin: Data(),
            socketPath: socketPath
        ))
        let decoded = try JSONDecoder().decode(
            MacAccessCLIResponse.self, from: status.output
        )
        XCTAssertEqual(decoded.status?.accessMode, .fullAccess)

        let setup = await Task.detached {
            MacAccessLocalControl.request(
                arguments: ["setup", "--json"],
                stdin: Data(),
                socketPath: socketPath
            )
        }.value
        XCTAssertEqual(try XCTUnwrap(setup).exitCode, 0)
        let setupCount = await MainActor.run { setupRecorder.count }
        XCTAssertEqual(setupCount, 1)
    }

    func testPairAcceptsCodeOnlyFromStdinAndDoesNotEchoIt() async {
        let secret = "ABCDEFGH2345"
        let client = StubCLIClient(result: .completed(.paired))
        let execution = await MacAccessCLI.execute(
            arguments: ["pair", "--code-stdin", "--json"],
            client: client,
            readStdin: { Data((secret.lowercased() + "\n").utf8) }
        )

        let output = String(decoding: execution.output, as: UTF8.self)
        let actions = await client.actions
        XCTAssertEqual(execution.exitCode, 0)
        XCTAssertFalse(output.contains(secret))
        XCTAssertEqual(actions, [.pair(secret)])
        XCTAssertNil(MacAccessCLI.parse(arguments: ["pair", secret]))
    }

    func testStatusTransportModesStopUnpairAndRevokeUseExistingXPCClientSurface() async {
        let cases: [([String], ConnectorCoreAction?)] = [
            (["status"], nil),
            (["connect"], .connect),
            (["disconnect"], .disconnect),
            (["mode", "off"], .setAccessMode(.off)),
            (["mode", "full"], .setAccessMode(.fullAccess)),
            (["stop"], .stop),
            (["unpair"], .unpair),
            (["revoke"], .revokeSelectedVM),
        ]

        for (arguments, expectedAction) in cases {
            let client = StubCLIClient()
            let execution = await MacAccessCLI.execute(
                arguments: arguments,
                client: client,
                readStdin: { Data() }
            )
            let actions = await client.actions
            XCTAssertEqual(execution.exitCode, 0, "\(arguments)")
            XCTAssertEqual(actions, expectedAction.map { [$0] } ?? [], "\(arguments)")
            let text = String(decoding: execution.output, as: UTF8.self)
            XCTAssertFalse(text.contains("relay_credential"))
            XCTAssertFalse(text.contains("pairing_code"))
        }

        XCTAssertNil(MacAccessCLI.parse(arguments: ["mode", "ask"]))
    }

    func testPermissionStatusAndRequestsUseHelperOwnedXPCSurface() async {
        let statusClient = StubCLIClient()
        let status = await MacAccessCLI.execute(
            arguments: ["permissions", "status", "--json"],
            client: statusClient,
            readStdin: { Data() }
        )
        XCTAssertEqual(status.exitCode, 0)
        XCTAssertTrue((try? JSONSerialization.jsonObject(with: status.output)) != nil)

        for (arguments, expected) in [
            (["permissions", "request", "accessibility"], MacAccessPermissionKind.accessibility),
            (["permissions", "request", "screen-recording"], MacAccessPermissionKind.screenRecording),
        ] {
            let client = StubCLIClient()
            let execution = await MacAccessCLI.execute(
                arguments: arguments,
                client: client,
                readStdin: { Data() }
            )
            XCTAssertEqual(execution.exitCode, 0)
            let requests = await client.permissionRequests
            XCTAssertEqual(requests, [expected])
        }
    }

    func testControllerBackedCLIStopLatchesEmergencyAgainstLaterConnect() async {
        let core = StatefulCLIClient()
        let initial = MacAccessState(
            connection: .connected,
            configuredMode: .fullAccess,
            effectiveMode: .fullAccess,
            isPaired: true,
            blocker: nil
        )
        let controller = await MainActor.run {
            MacAccessController(
                client: core,
                initialState: initial,
                availability: .internalAlpha
            )
        }
        let client = MacAccessControllerCLIClient(
            controller: controller,
            statusClient: core
        )

        let stopped = await client.perform(.stop)
        XCTAssertEqual(stopped, .completed(.localEmergencyStop))
        let reconnect = await client.perform(.connect)
        XCTAssertEqual(reconnect, .blocked(.emergencyStopActive))
        let actions = await core.actions
        XCTAssertEqual(actions, [.stop])
        let status = await client.fetchStatus()
        XCTAssertEqual(status?.status.transport, "stopped")
        XCTAssertEqual(status?.status.accessMode, .off)
    }
}

@MainActor
private final class SetupInvocationRecorder {
    private(set) var count = 0

    func record() {
        count += 1
    }
}

private actor StatefulCLIClient: MacAccessCLIClient {
    private var mode = MacAccessMode.off
    private var transport = "connected"
    private(set) var actions: [ConnectorCoreAction] = []

    func perform(_ action: ConnectorCoreAction) -> ConnectorCoreResult {
        actions.append(action)
        if case .setAccessMode(let value) = action {
            mode = value
            return .completed(.accessModeSet(value))
        }
        switch action {
        case .stop:
            mode = .off
            transport = "stopped"
            return .completed(.localStop)
        case .connect:
            transport = "connected"
            return .completed(.connected)
        case .disconnect:
            transport = "disconnected"
            return .completed(.disconnected)
        case .pair:
            return .completed(.paired)
        case .unpair:
            return .completed(.unpaired)
        case .revokeSelectedVM:
            return .completed(.revoked)
        case .pause:
            return .completed(.localPause)
        case .resume:
            return .completed(.localResume)
        case .setAccessMode:
            preconditionFailure("handled above")
        }
    }

    func fetchStatus() -> MacAccessXPCReply? {
        MacAccessXPCReply(
            code: .ok,
            status: MacAccessXPCSafeStatus(
                pairing: "paired",
                transport: transport,
                lastErrorCode: transport == "stopped" ? "stopped" : nil,
                lastAuditID: "redacted-audit-1",
                permissions: MacAccessPermissionStatus(
                    accessibility: .granted,
                    screenRecording: .granted
                ),
                accessMode: mode
            )
        )
    }

    func requestPermission(_ kind: MacAccessPermissionKind) -> MacAccessXPCReply? {
        fetchStatus()
    }
}
