import Foundation
import XCTest
@testable import MacAccessShared

private actor RecordingCLIClient: MacAccessStatusProjectingClient {
    let result: ConnectorCoreResult
    let reply: MacAccessXPCReply?
    private(set) var actions: [ConnectorCoreAction] = []
    private(set) var approvals: [(MacAccessXPCApproval, Bool)] = []

    init(
        result: ConnectorCoreResult = .completed(.connected),
        reply: MacAccessXPCReply? = CLITests.safeReply()
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

    func resolvePendingApproval(
        _ approval: MacAccessXPCApproval,
        allow: Bool
    ) -> MacAccessXPCReply? {
        approvals.append((approval, allow))
        return reply
    }
}

final class CLITests: XCTestCase {
    static func safeReply(
        pendingApproval: MacAccessXPCPendingApproval? = nil
    ) -> MacAccessXPCReply {
        MacAccessXPCReply(
            code: .ok,
            status: MacAccessXPCSafeStatus(
                pairing: "paired",
                transport: "connected",
                lastErrorCode: nil,
                lastAuditID: "audit-redacted-1",
                configuredMode: "ask_every_time",
                effectiveMode: "ask_every_time",
                paused: false,
                killSwitch: false,
                policyEpoch: 7,
                policyProvider: "mac_connector_core",
                auditEventCount: 1,
                pendingApproval: pendingApproval,
                recentAuditEvents: [
                    MacAccessXPCAuditEvent(
                        occurredAt: Date(timeIntervalSince1970: 1_700_000_000),
                        capability: "customer_mac.desktop_click",
                        outcome: "allowed",
                        reasonCode: "approved_once"
                    ),
                ]
            )
        )
    }

    func testCLIEntrypointDistinguishesGUIAndCommands() {
        XCTAssertFalse(MacAccessCLI.shouldRun(arguments: []))
        XCTAssertFalse(MacAccessCLI.shouldRun(arguments: ["-psn_0_12345"]))
        XCTAssertFalse(MacAccessCLI.shouldRun(arguments: ["-NSDocumentRevisionsDebugMode", "YES"]))
        XCTAssertTrue(MacAccessCLI.shouldRun(arguments: ["status"]))
        XCTAssertTrue(MacAccessCLI.shouldRun(arguments: ["--help"]))
    }

    func testParserCoversLifecyclePolicyApprovalAndRejectsCodeInArguments() throws {
        XCTAssertEqual(try MacAccessCLI.parse(arguments: ["status", "--json"]), .status)
        XCTAssertEqual(try MacAccessCLI.parse(arguments: ["pair", "--code-stdin"]), .pairFromStdin)
        XCTAssertEqual(try MacAccessCLI.parse(arguments: ["access-mode", "off"]), .accessMode(.off))
        XCTAssertEqual(
            try MacAccessCLI.parse(arguments: ["access-mode", "ask-every-time"]),
            .accessMode(.askEveryTime)
        )
        XCTAssertEqual(
            try MacAccessCLI.parse(arguments: ["access-mode", "full-access"]),
            .accessMode(.fullAccess)
        )
        XCTAssertEqual(
            try MacAccessCLI.parse(arguments: ["approval", "approve", "command-1"]),
            .approvalApprove("command-1")
        )
        XCTAssertThrowsError(try MacAccessCLI.parse(arguments: ["pair", "ABCDEFGH2345"]))
        XCTAssertThrowsError(try MacAccessCLI.parse(arguments: ["pair", "--code", "ABCDEFGH2345"]))
        XCTAssertThrowsError(try MacAccessCLI.parse(arguments: ["--json", "--json", "status"]))
    }

    func testPairReadsOnlyStdinAndNeverReturnsCode() async throws {
        let secretCode = "ABCDEFGH2345"
        let client = RecordingCLIClient(
            result: .completed(.paired),
            reply: Self.safeReply()
        )

        let execution = await MacAccessCLI.execute(
            arguments: ["pair", "--code-stdin", "--json"],
            client: client,
            build: testBuild,
            readStdin: { Data((secretCode.lowercased() + "\n").utf8) }
        )

        XCTAssertEqual(execution.exitCode, 0)
        XCTAssertFalse(execution.writesToStandardError)
        XCTAssertFalse(String(decoding: execution.output, as: UTF8.self).contains(secretCode))
        let actions = await client.actions
        XCTAssertEqual(actions, [.pair(secretCode)])
    }

    func testEveryLifecycleCommandUsesExistingCoreAction() async {
        let cases: [([String], ConnectorCoreAction)] = [
            (["connect"], .connect),
            (["disconnect"], .disconnect),
            (["access-mode", "off"], .setAccessMode(.off)),
            (["access-mode", "ask-every-time"], .setAccessMode(.askEveryTime)),
            (["access-mode", "full-access"], .setAccessMode(.fullAccess)),
            (["pause"], .pause),
            (["resume"], .resume),
            (["stop"], .stop),
            (["revoke"], .revokeSelectedVM),
            (["emergency-stop"], .activateKillSwitch),
        ]

        for (arguments, expected) in cases {
            let client = RecordingCLIClient()
            let execution = await MacAccessCLI.execute(
                arguments: arguments,
                client: client,
                build: testBuild,
                readStdin: { Data() }
            )
            XCTAssertEqual(execution.exitCode, 0, "\(arguments)")
            let actions = await client.actions
            XCTAssertEqual(actions, [expected], "\(arguments)")
        }
    }

    func testStatusAuditAndDiagnosticsAreStructuredAndRedacted() async throws {
        for arguments in [["status"], ["audit"], ["diagnostics"], ["version"]] {
            let execution = await MacAccessCLI.execute(
                arguments: arguments,
                client: RecordingCLIClient(),
                build: testBuild,
                readStdin: { Data() }
            )
            XCTAssertEqual(execution.exitCode, 0, "\(arguments)")
            let text = String(decoding: execution.output, as: UTF8.self)
            XCTAssertTrue(text.contains(#""schema_version":"evaos.mac_access.cli_response.v1""#))
            XCTAssertFalse(text.contains("relay_credential"))
            XCTAssertFalse(text.contains("pairing_code"))
            XCTAssertFalse(text.contains("private_key"))
            XCTAssertFalse(text.contains("wss://"))
            _ = try XCTUnwrap(JSONSerialization.jsonObject(with: execution.output) as? [String: Any])
        }
    }

    func testApprovalRequiresExactCurrentCommandID() async {
        let pending = pendingApproval()
        let client = RecordingCLIClient(reply: Self.safeReply(pendingApproval: pending))

        let mismatch = await MacAccessCLI.execute(
            arguments: ["approval", "approve", "different-command"],
            client: client,
            build: testBuild,
            readStdin: { Data() }
        )
        XCTAssertEqual(mismatch.exitCode, 65)
        let mismatchApprovals = await client.approvals
        XCTAssertTrue(mismatchApprovals.isEmpty)

        let approved = await MacAccessCLI.execute(
            arguments: ["approval", "approve", pending.approval.commandID],
            client: client,
            build: testBuild,
            readStdin: { Data() }
        )
        XCTAssertEqual(approved.exitCode, 0)
        let approvals = await client.approvals
        XCTAssertEqual(approvals.count, 1)
        XCTAssertEqual(approvals.first?.0, pending.approval)
        XCTAssertEqual(approvals.first?.1, true)
    }

    func testUsageAndUnavailableFailuresAreTypedAndNonzero() async {
        let unavailable = RecordingCLIClient(reply: nil)
        let invalid = await MacAccessCLI.execute(
            arguments: ["unknown-command"],
            client: unavailable,
            build: testBuild,
            readStdin: { Data() }
        )
        XCTAssertEqual(invalid.exitCode, 64)
        XCTAssertTrue(invalid.writesToStandardError)

        let status = await MacAccessCLI.execute(
            arguments: ["status"],
            client: unavailable,
            build: testBuild,
            readStdin: { Data() }
        )
        XCTAssertEqual(status.exitCode, 69)
        XCTAssertTrue(String(decoding: status.output, as: UTF8.self).contains("helper_unavailable"))
    }

    private var testBuild: MacAccessCLIBuildInfo {
        MacAccessCLIBuildInfo(
            marketingVersion: "0.1.0",
            buildVersion: "test",
            sourceCommit: "0123456789abcdef"
        )
    }

    private func pendingApproval() -> MacAccessXPCPendingApproval {
        MacAccessXPCPendingApproval(
            approval: MacAccessXPCApproval(
                commandID: "command-1",
                capability: "customer_mac.desktop_click",
                requestDigestSHA256: String(repeating: "a", count: 64),
                bindingFingerprintSHA256: String(repeating: "b", count: 64),
                policyEpoch: 7,
                envelopeDigestSHA256: String(repeating: "c", count: 64),
                ttlSeconds: 30
            ),
            expiresAt: Date(timeIntervalSince1970: 1_700_000_030),
            targetX: 0.25,
            targetY: 0.75,
            deviceID: "device-redacted-1"
        )
    }
}
