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
            (["mode", "ask"], .setAccessMode(.askEveryTime)),
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
}
