import CryptoKit
import Foundation
import MacAccessShared
import XCTest

private final class PolicyTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date
    init(_ value: Date) { self.value = value }
    func now() -> Date { lock.withLock { value } }
    func advance(_ interval: TimeInterval) { lock.withLock { value.addTimeInterval(interval) } }
}

private actor PolicyTestVault: MacAccessCredentialVault {
    var record: MacAccessCredentialRecord?
    init(_ record: MacAccessCredentialRecord? = nil) { self.record = record }
    func load() -> MacAccessCredentialRecord? { record }
    func save(_ record: MacAccessCredentialRecord) { self.record = record }
    func erase() { record = nil }
}

private actor PolicyClickCounter {
    private(set) var count = 0
    func increment() { count += 1 }
}

private actor MemoryAuditAnchorStore: MacAccessAuditAnchorStore {
    private var anchor: MacAccessAuditAnchor?
    func load() -> MacAccessAuditAnchor? { anchor }
    func save(_ anchor: MacAccessAuditAnchor) { self.anchor = anchor }
}

private actor ScriptedCoreHostChannel: MacAccessCoreHostChannel {
    private var queued: [Data] = []
    private var receivers: [CheckedContinuation<Data, Error>] = []
    private var dispatchRequest: [String: JSONValue]?

    func send(_ data: Data) throws {
        guard case .object(let frame) = try JSONDecoder().decode(JSONValue.self, from: data),
              let type = frame["message_type"]?.string
        else { throw MacAccessCoreHostError.protocolViolation }
        if type == "host_request" {
            guard let request = frame["request"]?.object,
                  let operation = request["operation"]?.string
            else { throw MacAccessCoreHostError.protocolViolation }
            if operation == "dispatch_action" {
                dispatchRequest = request
                enqueue(.object([
                    "schema_version": .string(MacAccessStdioCoreHostTransport.schema),
                    "message_type": .string("port_call"),
                    "call_id": .string("call-native-begin"),
                    "port": .string("native"),
                    "method": .string("begin"),
                    "arguments": .object(["envelope": request["envelope"] ?? .null]),
                ]))
                return
            }
            let epoch: Int64 = operation == "pair" ? 1 : 2
            enqueue(hostResponse(request: request, epoch: epoch, result: [
                "kind": .string(operation == "pair" ? "pairing" : "lifecycle"),
            ]))
        } else if type == "port_result" {
            guard frame["call_id"]?.string == "call-native-begin",
                  frame["ok"]?.boolean == true,
                  let request = dispatchRequest
            else { throw MacAccessCoreHostError.protocolViolation }
            enqueue(hostResponse(request: request, epoch: 2, result: [
                "kind": .string("action"),
                "outcome": .string("executed"),
                "decision_audit_id": .string("audit-decision-01"),
                "result_audit_id": .string("audit-result-01"),
            ]))
        } else {
            throw MacAccessCoreHostError.protocolViolation
        }
    }

    func receiveLine() async throws -> Data {
        if !queued.isEmpty { return queued.removeFirst() }
        return try await withCheckedThrowingContinuation { receivers.append($0) }
    }

    func terminate() {
        for receiver in receivers { receiver.resume(throwing: MacAccessCoreHostError.runnerExited) }
        receivers.removeAll()
    }

    private func enqueue(_ value: JSONValue) {
        let data = try! JSONEncoder().encode(value)
        if receivers.isEmpty { queued.append(data) }
        else { receivers.removeFirst().resume(returning: data) }
    }

    private func hostResponse(
        request: [String: JSONValue], epoch: Int64, result: [String: JSONValue]
    ) -> JSONValue {
        .object([
            "schema_version": .string(MacAccessStdioCoreHostTransport.schema),
            "message_type": .string("host_response"),
            "response": .object([
                "schema_version": .string("evaos.mac_connector_core.host_response.v1"),
                "request_id": request["request_id"] ?? .null,
                "host_session_id": request["host_session_id"] ?? .null,
                "sequence": request["sequence"] ?? .integer(1),
                "operation": request["operation"] ?? .string("status"),
                "ok": .boolean(true),
                "policy_epoch": .integer(epoch),
                "result": .object(result),
                "error": .null,
            ]),
        ])
    }
}

final class PolicyBridgeTests: XCTestCase {
    func testCorruptCustodyRecoversPersistentOfflineKillAcrossRestart() async throws {
        let directory = temporaryDirectory()
        let paths = MacAccessPolicyPaths(directory: directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("not-json".utf8).write(to: paths.custody)

        let recovered = try MacAccessPolicyCustody(paths: paths, hostSessionID: "host-one")
        let first = await recovered.projectStatus()
        XCTAssertTrue(first.killSwitch)
        XCTAssertEqual(first.effectiveMode, "off")

        let restarted = try MacAccessPolicyCustody(paths: paths, hostSessionID: "host-two")
        let second = await restarted.projectStatus()
        XCTAssertTrue(second.killSwitch)
        XCTAssertEqual(second.transport, "blocked")
        XCTAssertEqual(try permissions(paths.custody), 0o600)
    }

    func testApprovalIsExactSingleUseAndExpiresWithinSixtySeconds() async throws {
        let clock = PolicyTestClock(Date(timeIntervalSince1970: 1_700_000_000))
        let custody = try MacAccessPolicyCustody(
            paths: MacAccessPolicyPaths(directory: temporaryDirectory()),
            hostSessionID: "host-approval", now: clock.now
        )
        let envelope = actionEnvelope(commandID: "command-approved")
        try await recordApproval(custody, envelope: envelope, ttl: 60)
        let firstApproval = try await custody.consumeApproval(envelope: envelope)
        let reusedApproval = try await custody.consumeApproval(envelope: envelope)
        XCTAssertNil(firstApproval)
        XCTAssertEqual(reusedApproval, "approval_denied")

        try await recordApproval(custody, envelope: envelope, ttl: 60)
        clock.advance(60)
        let expiredApproval = try await custody.consumeApproval(envelope: envelope)
        XCTAssertEqual(expiredApproval, "approval_denied")

        var wrong = envelope
        wrong["command_id"] = .string("command-wrong")
        try await recordApproval(custody, envelope: envelope, ttl: 1)
        let wrongApproval = try await custody.consumeApproval(envelope: wrong)
        XCTAssertEqual(wrongApproval, "approval_denied")
    }

    func testPendingAskApprovalIsVisibleExactAndKillCancelsWaiter() async throws {
        let custody = try MacAccessPolicyCustody(
            paths: MacAccessPolicyPaths(directory: temporaryDirectory()),
            hostSessionID: "host-pending"
        )
        let envelope = actionEnvelope(commandID: "command-pending")
        let waiter = Task { try await custody.awaitApproval(envelope: envelope) }
        var pending: MacAccessXPCPendingApproval?
        while pending == nil {
            pending = await custody.currentPendingApproval()
            await Task.yield()
        }
        var wrong = pending!.approval
        wrong = MacAccessXPCApproval(
            commandID: wrong.commandID,
            capability: wrong.capability,
            requestDigestSHA256: wrong.requestDigestSHA256,
            bindingFingerprintSHA256: wrong.bindingFingerprintSHA256,
            policyEpoch: wrong.policyEpoch,
            envelopeDigestSHA256: String(repeating: "a", count: 64),
            ttlSeconds: wrong.ttlSeconds
        )
        let wrongResolution = await custody.resolvePendingApproval(wrong, allow: true)
        XCTAssertFalse(wrongResolution)
        _ = try await custody.activateEmergencyKill()
        let rejection = try await waiter.value
        XCTAssertEqual(rejection, "approval_denied")
        let pendingAfterKill = await custody.currentPendingApproval()
        XCTAssertNil(pendingAfterKill)
    }

    func testReplayTombstoneSurvivesRestart() async throws {
        let paths = MacAccessPolicyPaths(directory: temporaryDirectory())
        let envelope = actionEnvelope(commandID: "command-replay")
        let first = try MacAccessPolicyCustody(paths: paths, hostSessionID: "host-replay")
        let firstBurn = try await first.burnReplay(envelope: envelope)
        XCTAssertTrue(firstBurn)

        let restarted = try MacAccessPolicyCustody(paths: paths, hostSessionID: "host-replay-next")
        let secondBurn = try await restarted.burnReplay(envelope: envelope)
        XCTAssertFalse(secondBurn)
    }

    func testAuditUsesCoreHostFieldAndDigestContractThenFailsClosedOnCorruption() async throws {
        let paths = MacAccessPolicyPaths(directory: temporaryDirectory())
        let audit = try MacAccessAuditCustody(paths: paths)
        let event = try await audit.append(
            envelope: actionEnvelope(commandID: "command-audit"),
            accessMode: "ask_every_time", allowed: true,
            reasonCode: "approved_exact_scope", detailCode: nil
        )
        XCTAssertEqual(event["actor"]?.object?["identity"]?.string, "policy_engine")
        XCTAssertEqual(event["evidence"]?.object?["redaction_policy"]?.string, "default_v1")
        XCTAssertNil(event["evidence"]?.object?["detail_code"])
        XCTAssertEqual(event["record_sha256"]?.string, try digest(event))
        XCTAssertEqual(try permissions(paths.audit), 0o600)

        let handle = try FileHandle(forWritingTo: paths.audit)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("{corrupt}\n".utf8))
        try handle.close()
        let healthyAfterCorruption = await audit.anchorHealthy()
        XCTAssertFalse(healthyAfterCorruption)
    }

    func testIndependentAuditAnchorRejectsDeletedJournal() async throws {
        let paths = MacAccessPolicyPaths(directory: temporaryDirectory())
        let anchorStore = MemoryAuditAnchorStore()
        let audit = try MacAccessAuditCustody(paths: paths, anchorStore: anchorStore)
        _ = try await audit.append(
            envelope: actionEnvelope(commandID: "command-anchored"),
            accessMode: "ask_every_time", allowed: true,
            reasonCode: "approved_exact_scope", detailCode: nil
        )
        let healthyBeforeDeletion = await audit.anchorHealthy()
        XCTAssertTrue(healthyBeforeDeletion)

        try FileManager.default.removeItem(at: paths.audit)

        let healthyAfterDeletion = await audit.anchorHealthy()
        XCTAssertFalse(healthyAfterDeletion)
    }

    func testAuditRotatesWithinBoundAndPreservesChain() async throws {
        let paths = MacAccessPolicyPaths(directory: temporaryDirectory())
        let audit = try MacAccessAuditCustody(paths: paths)
        for index in 0..<260 {
            _ = try await audit.append(
                envelope: actionEnvelope(commandID: "command-rotate-\(index)"),
                accessMode: "ask_every_time", allowed: false,
                reasonCode: "denied_approval", detailCode: "approval_rejected"
            )
        }
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: paths.directory.appendingPathComponent("audit.ndjson.1").path
        ))
        let healthyAfterRotation = await audit.anchorHealthy()
        XCTAssertTrue(healthyAfterRotation)
    }

    func testMalformedClickDeniedAndValidClickIsBounded() async throws {
        let counter = PolicyClickCounter()
        let native = MacAccessNativeClickPort(
            performer: { _, _ in await counter.increment(); return true },
            isAccessibilityTrusted: { true }
        )
        var malformed = actionEnvelope(commandID: "command-malformed")
        malformed["command"] = .object([
            "capability": .string("customer_mac.desktop_click"),
            "request": .object(["x": .number(2), "y": .number(0.5)]),
            "request_digest_sha256": .string(String(repeating: "d", count: 64)),
        ])
        let malformedError = await native.validationError(for: malformed)
        XCTAssertNotNil(malformedError)
        await XCTAssertThrowsErrorAsync { _ = try await native.begin(envelope: malformed) }

        let actionID = try await native.begin(envelope: actionEnvelope(commandID: "command-valid"))
        let clickResult = await native.wait(actionID: actionID)
        let clickCount = await counter.count
        XCTAssertEqual(clickResult["outcome"]?.string, "executed")
        XCTAssertEqual(clickCount, 1)
    }

    func testEmergencyCancellationWaitsForNativeTaskToQuiesce() async throws {
        let native = MacAccessNativeClickPort(
            performer: { _, _ in
                try? await Task.sleep(for: .seconds(30))
                return true
            },
            isAccessibilityTrusted: { true }
        )
        let actionID = try await native.begin(envelope: actionEnvelope(commandID: "command-cancel"))
        let waiter = Task { await native.wait(actionID: actionID) }
        await native.cancelAll()
        let result = await waiter.value
        XCTAssertEqual(result["outcome"]?.string, "stopped")
    }

    func testMissingRunnerFailsClosedAndEmergencyKillPersists() async throws {
        let paths = MacAccessPolicyPaths(directory: temporaryDirectory())
        let vault = PolicyTestVault()
        let custody = try MacAccessPolicyCustody(paths: paths, hostSessionID: "host-missing")
        let audit = try MacAccessAuditCustody(paths: paths)
        let native = MacAccessNativeClickPort(isAccessibilityTrusted: { true })
        let dispatcher = MacAccessCoreHostPortDispatcher(
            custody: custody, audit: audit, native: native, vault: vault
        )
        let transport = MacAccessStdioCoreHostTransport(
            launcher: { throw MacAccessCoreHostError.runtimeUnavailable }, dispatcher: dispatcher
        )
        let client = MacAccessCoreHostClient(
            transport: transport, hostSessionID: "host-missing", custody: custody
        )
        let executor = CoreHostBackedMacAccessExecutor(client: client)
        let denied = await executor.execute(command: brokerCommand())
        XCTAssertEqual(denied.outcome, .denied)
        XCTAssertEqual(denied.errorCode, MacAccessPublicError.policyUnavailable.rawValue)

        let runtime = MacAccessPolicyRuntime(
            client: client, custody: custody, audit: audit, native: native
        )
        let killResult = await runtime.perform(
            MacAccessXPCPolicyRequest(operation: .activateKillSwitch)
        )
        XCTAssertEqual(killResult, .ok)
        let restarted = try MacAccessPolicyCustody(paths: paths, hostSessionID: "host-after-kill")
        let restartedStatus = await restarted.projectStatus()
        XCTAssertTrue(restartedStatus.killSwitch)
    }

    func testPairConnectAskApprovalAndBrokerClickReachNativePort() async throws {
        let paths = MacAccessPolicyPaths(directory: temporaryDirectory())
        let command = brokerCommand()
        let vault = PolicyTestVault(credentialRecord(binding: command.binding))
        let custody = try MacAccessPolicyCustody(paths: paths, hostSessionID: "host-composed")
        let audit = try MacAccessAuditCustody(paths: paths)
        let counter = PolicyClickCounter()
        let native = MacAccessNativeClickPort(
            performer: { _, _ in await counter.increment(); return true },
            isAccessibilityTrusted: { true }
        )
        let dispatcher = MacAccessCoreHostPortDispatcher(
            custody: custody, audit: audit, native: native, vault: vault
        )
        let channel = ScriptedCoreHostChannel()
        let transport = MacAccessStdioCoreHostTransport(launcher: { channel }, dispatcher: dispatcher)
        let client = MacAccessCoreHostClient(
            transport: transport, hostSessionID: "host-composed", custody: custody
        )
        let runtime = MacAccessPolicyRuntime(
            client: client, custody: custody, audit: audit, native: native
        )

        try await runtime.synchronizePairing(code: "ABCDEF12")
        try await runtime.synchronizeConnection(binding: command.binding)
        let encodedCommand = try JSONEncoder().encode(command)
        guard case .object(let commandEnvelope) = try JSONDecoder().decode(
            JSONValue.self, from: encodedCommand
        ) else { return XCTFail("command did not encode as an object") }
        try await custody.authorizeNative(envelope: commandEnvelope)
        let result = await CoreHostBackedMacAccessExecutor(client: client).execute(command: command)

        XCTAssertEqual(result.outcome, .executed)
        let clickCount = await counter.count
        XCTAssertEqual(clickCount, 1)
    }

    func testProductionRunnerArgumentsPinPrivateRuntimeAndIdentity() {
        let arguments = MacAccessStdioCoreHostTransport.productionArguments(
            source: URL(fileURLWithPath: "/private/core/python"),
            hostSessionID: "host-contract", runtimeInstanceID: "runtime-contract"
        )
        XCTAssertEqual(arguments.suffix(4), [
            "--host-session-id", "host-contract", "--runtime-instance-id", "runtime-contract",
        ])
        XCTAssertEqual(arguments.first, "-I")
        XCTAssertTrue(arguments.joined(separator: " ").contains("raise SystemExit(main(sys.argv[2:]))"))
    }

    private func temporaryDirectory() -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("mac-access-policy-tests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func permissions(_ url: URL) throws -> Int {
        (try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber)?.intValue ?? 0
    }

    private func actionEnvelope(commandID: String) -> [String: JSONValue] {
        [
            "command_id": .string(commandID),
            "policy_epoch": .integer(2),
            "nonce": .string("bm9uY2UtMDE"),
            "binding": .object(["binding_fingerprint_sha256": .string(String(repeating: "b", count: 64))]),
            "command": .object([
                "capability": .string("customer_mac.desktop_click"),
                "request": .object(["x": .number(0.5), "y": .number(0.5)]),
                "request_digest_sha256": .string(String(repeating: "d", count: 64)),
            ]),
        ]
    }

    private func recordApproval(
        _ custody: MacAccessPolicyCustody,
        envelope: [String: JSONValue],
        ttl: TimeInterval
    ) async throws {
        try await custody.recordApproval(
            commandID: envelope["command_id"]!.string!,
            capability: envelope["command"]!.object!["capability"]!.string!,
            requestDigestSHA256: envelope["command"]!.object!["request_digest_sha256"]!.string!,
            bindingFingerprintSHA256: envelope["binding"]!.object!["binding_fingerprint_sha256"]!.string!,
            policyEpoch: envelope["policy_epoch"]!.integer!,
            envelopeDigestSHA256: try envelopeDigest(envelope), ttl: ttl
        )
    }

    private func envelopeDigest(_ envelope: [String: JSONValue]) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return MacAccessWire.sha256Hex(try encoder.encode(JSONValue.object(envelope)))
    }

    private func digest(_ event: [String: JSONValue]) throws -> String {
        var payload = event
        payload.removeValue(forKey: "record_sha256")
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return SHA256.hash(data: try encoder.encode(JSONValue.object(payload)))
            .map { String(format: "%02x", $0) }.joined()
    }

    private func brokerCommand() -> MacAccessBrokerCommand {
        let binding = MacAccessSelectedBinding(
            customerID: "customer-01", customerVMID: "vm-01", deviceID: "mac-01",
            grantID: "grant-01", runtime: "openclaw", bindingID: "binding-01",
            bindingVersion: "v1", grantExpiresAt: "2030-01-02T03:04:05Z",
            connectorInstallationID: "install-01", connectorKeyID: "key-01",
            bindingFingerprintSHA256: String(repeating: "b", count: 64)
        )
        let requestDigest = String(repeating: "d", count: 64)
        let payload = MacAccessCommandAuthorityPayload(
            schemaVersion: "evaos.mac_access.command_authorization_payload.v1",
            domain: "evaos.mac-access/command-authority/v1",
            sessionID: "session-01", channelGenerationID: "channel-01",
            commandID: "command-click-01", issuedAt: "2029-01-01T00:00:00Z",
            expiresAt: "2029-01-01T00:00:30Z", sequence: 1, policyEpoch: 2,
            nonce: "bm9uY2UtMDE", binding: binding,
            executionContextSHA256: String(repeating: "e", count: 64),
            capability: "customer_mac.desktop_click", requestDigestSHA256: requestDigest
        )
        return MacAccessBrokerCommand(
            schemaVersion: "evaos.mac_access.broker_control.v1", messageType: "command",
            sessionID: payload.sessionID, channelGenerationID: payload.channelGenerationID,
            commandID: payload.commandID, issuedAt: payload.issuedAt, expiresAt: payload.expiresAt,
            sequence: payload.sequence, policyEpoch: payload.policyEpoch, nonce: payload.nonce,
            binding: binding,
            executionContext: MacAccessExecutionContext(
                claims: MacAccessExecutionContextClaims(
                    schemaVersion: "evaos.mac_control_execution_context.v1", keyID: "context-key",
                    runtime: "openclaw", customerID: "customer-01", customerVMID: "vm-01",
                    bindingID: "binding-01", bindingVersion: "v1",
                    issuedAt: 1_862_000_000, expiresAt: 1_900_000_000, contextID: "Y29udGV4dA"
                ),
                payloadBase64URL: "Y29udGV4dA", payloadSHA256: String(repeating: "e", count: 64),
                signatureBase64URL: "c2lnbmF0dXJl", keyID: "context-key"
            ),
            command: MacAccessCommandBody(
                capability: "customer_mac.desktop_click",
                request: ["x": .number(0.5), "y": .number(0.5)],
                requestDigestSHA256: requestDigest
            ),
            authorization: MacAccessCommandAuthorization(
                schemaVersion: "evaos.mac_access.command_authorization.v1",
                canonicalization: "RFC8785-JCS", payload: payload,
                payloadSHA256: String(repeating: "a", count: 64),
                keyID: "command-key", signatureBase64URL: "c2lnbmF0dXJl"
            )
        )
    }

    private func credentialRecord(binding: MacAccessSelectedBinding) -> MacAccessCredentialRecord {
        MacAccessCredentialRecord(
            privateKeyRaw: Data(repeating: 1, count: 32),
            connectorInstallationID: binding.connectorInstallationID,
            connectorKeyID: binding.connectorKeyID,
            binding: binding, relayCredential: "credential",
            relayCredentialExpiresAt: "2030-01-02T03:04:05Z", pairingAuditID: "audit-pair"
        )
    }
}

private func XCTAssertThrowsErrorAsync(
    _ operation: () async throws -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        try await operation()
        XCTFail("Expected error", file: file, line: line)
    } catch {}
}
