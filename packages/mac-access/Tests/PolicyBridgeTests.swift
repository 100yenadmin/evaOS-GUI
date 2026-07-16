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
    private var decisionEvent: [String: JSONValue]?

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
                try enqueue(portCall(
                    callID: "call-approval", port: "authority", method: "approve_action",
                    arguments: [
                        "envelope": request["envelope"] ?? .null,
                        "state": .object([:]),
                    ]
                ))
                return
            }
            let epoch: Int64 = operation == "pair" ? 1 : 2
            try enqueue(hostResponse(request: request, epoch: epoch, result: [
                "kind": .string(operation == "pair" ? "pairing" : "lifecycle"),
            ]))
        } else if type == "port_result" {
            guard frame["ok"]?.boolean == true,
                  let callID = frame["call_id"]?.string,
                  let request = dispatchRequest
            else { throw MacAccessCoreHostError.protocolViolation }
            switch callID {
            case "call-approval":
                try enqueue(portCall(
                    callID: "call-audit-decision", port: "audit",
                    method: "command_decision", arguments: [
                        "envelope": request["envelope"] ?? .null,
                        "allowed": .boolean(true),
                        "reason_code": .string("approved_exact_scope"),
                        "detail_code": .null,
                    ]
                ))
            case "call-audit-decision":
                guard let decision = frame["result"]?.object else {
                    throw MacAccessCoreHostError.protocolViolation
                }
                decisionEvent = decision
                try enqueue(portCall(
                    callID: "call-native-begin", port: "native", method: "begin",
                    arguments: ["envelope": request["envelope"] ?? .null]
                ))
            case "call-native-begin":
                guard let actionID = frame["result"]?.object?["action_id"] else {
                    throw MacAccessCoreHostError.protocolViolation
                }
                try enqueue(portCall(
                    callID: "call-native-wait", port: "native", method: "wait",
                    arguments: ["action_id": actionID]
                ))
            case "call-native-wait":
                guard let outcome = frame["result"]?.object?["outcome"],
                      let decisionEvent
                else { throw MacAccessCoreHostError.protocolViolation }
                try enqueue(portCall(
                    callID: "call-audit-result", port: "audit", method: "command_result",
                    arguments: [
                        "envelope": request["envelope"] ?? .null,
                        "decision": .object(decisionEvent),
                        "outcome": outcome,
                        "reason_code": .string("approved_exact_scope"),
                        "detail_code": .string("actuation_succeeded"),
                    ]
                ))
            case "call-audit-result":
                guard let resultEvent = frame["result"]?.object,
                      let decisionAuditID = decisionEvent?["audit_id"],
                      let resultAuditID = resultEvent["audit_id"]
                else { throw MacAccessCoreHostError.protocolViolation }
                try enqueue(hostResponse(request: request, epoch: 2, result: [
                    "kind": .string("action"),
                    "outcome": .string("executed"),
                    "decision_audit_id": decisionAuditID,
                    "result_audit_id": resultAuditID,
                ]))
            default:
                throw MacAccessCoreHostError.protocolViolation
            }
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

    private func enqueue(_ value: JSONValue) throws {
        let data = try JSONEncoder().encode(value)
        if receivers.isEmpty { queued.append(data) }
        else { receivers.removeFirst().resume(returning: data) }
    }

    private func portCall(
        callID: String, port: String, method: String, arguments: [String: JSONValue]
    ) -> JSONValue {
        .object([
            "schema_version": .string(MacAccessStdioCoreHostTransport.schema),
            "message_type": .string("port_call"),
            "call_id": .string(callID),
            "port": .string(port),
            "method": .string(method),
            "arguments": .object(arguments),
        ])
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

private actor StalledCoreHostChannel: MacAccessCoreHostChannel {
    func send(_ data: Data) {}

    func receiveLine() async throws -> Data {
        try await Task.sleep(for: .seconds(3_600))
        throw MacAccessCoreHostError.runnerExited
    }

    func terminate() {}
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
        XCTAssertEqual(pending?.targetX, 0.5)
        XCTAssertEqual(pending?.targetY, 0.5)
        XCTAssertEqual(pending?.deviceID, "mac-01")
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

    func testLocalStopPreemptsPendingApprovalBeforeCoreSynchronization() async throws {
        let custody = try MacAccessPolicyCustody(
            paths: MacAccessPolicyPaths(directory: temporaryDirectory()),
            hostSessionID: "host-local-stop"
        )
        let envelope = actionEnvelope(commandID: "command-stop-pending")
        let waiter = Task { try await custody.awaitApproval(envelope: envelope) }
        while await custody.currentPendingApproval() == nil { await Task.yield() }

        let stopped = try await custody.forceLocalSafety("stop")

        let pendingResult = try await waiter.value
        XCTAssertEqual(pendingResult, "approval_denied")
        XCTAssertEqual(stopped.effectiveMode, "off")
        XCTAssertTrue(stopped.paused)
        XCTAssertEqual(stopped.transport, "disconnected")
    }

    func testEmergencyResetReturnsUnpairedOffAndCannotRestoreAuthority() async throws {
        let custody = try MacAccessPolicyCustody(
            paths: MacAccessPolicyPaths(directory: temporaryDirectory()),
            hostSessionID: "host-emergency-reset"
        )
        let killed = try await custody.activateEmergencyKill()
        let reset = try await custody.clearEmergencyKill(expectedPolicyEpoch: killed.policyEpoch)

        XCTAssertEqual(reset.pairing, "unpaired")
        XCTAssertEqual(reset.configuredMode, "off")
        XCTAssertEqual(reset.effectiveMode, "off")
        XCTAssertEqual(reset.transport, "disconnected")
        XCTAssertFalse(reset.killSwitch)
        let reopened = await custody.openNativeBarrierIfAllowed()
        XCTAssertFalse(reopened)
    }

    func testChildStateRewriteCannotOpenNativeBarrierWithoutLocalModeAction() async throws {
        let custody = try MacAccessPolicyCustody(
            paths: MacAccessPolicyPaths(directory: temporaryDirectory()),
            hostSessionID: "host-state-rewrite"
        )
        let envelope = actionEnvelope(commandID: "command-state-rewrite")
        var rewritten = await custody.loadState()
        let revision = try XCTUnwrap(rewritten["revision"]?.integer)
        rewritten["pairing_state"] = .string("paired")
        rewritten["transport_state"] = .string("connected")
        rewritten["configured_mode"] = .string("full_access")
        rewritten["effective_mode"] = .string("full_access")
        rewritten["paused"] = .boolean(false)
        rewritten["kill_switch"] = .boolean(false)
        rewritten["policy_epoch"] = envelope["policy_epoch"]
        let rewroteState = try await custody.compareAndSwap(
            expectedRevision: revision, state: rewritten
        )
        XCTAssertTrue(rewroteState)
        try await custody.authorizeRelayAdmission(envelope: envelope)
        try await custody.authorizeNative(envelope: envelope)

        let openedWithoutLocalAction = await custody.openNativeBarrierIfAllowed()
        let consumedWithoutLocalAction = await custody.consumeNativeAuthorization(envelope: envelope)
        XCTAssertFalse(openedWithoutLocalAction)
        XCTAssertFalse(consumedWithoutLocalAction)

        try await custody.authorizeLocalMode("full_access")
        let openedAfterLocalAction = await custody.openNativeBarrierIfAllowed()
        XCTAssertTrue(openedAfterLocalAction)
        try await custody.authorizeRelayAdmission(envelope: envelope)
        try await custody.authorizeNative(envelope: envelope)
        let committed = await custody.markAllowedDecisionCommitted(envelope: envelope)
        XCTAssertTrue(committed)
        let consumedAfterLocalAction = await custody.consumeNativeAuthorization(envelope: envelope)
        XCTAssertTrue(consumedAfterLocalAction)
    }

    func testStaleChildCASCannotClearKillAndResetCannotClearNewerKill() async throws {
        let custody = try MacAccessPolicyCustody(
            paths: MacAccessPolicyPaths(directory: temporaryDirectory()),
            hostSessionID: "host-kill-cas"
        )
        let staleState = await custody.loadState()
        let staleRevision = try XCTUnwrap(staleState["revision"]?.integer)
        let firstKill = try await custody.activateEmergencyKill()

        let staleCAS = try await custody.compareAndSwap(
            expectedRevision: staleRevision, state: staleState
        )
        XCTAssertFalse(staleCAS)

        let secondKill = try await custody.activateEmergencyKill()
        await XCTAssertThrowsErrorAsync {
            _ = try await custody.clearEmergencyKill(expectedPolicyEpoch: firstKill.policyEpoch)
        }
        let projection = await custody.projectStatus()
        XCTAssertTrue(projection.killSwitch)
        XCTAssertEqual(projection.policyEpoch, secondKill.policyEpoch)
    }

    func testFreshPairingPreparationRecoversRevokedStateWithoutClearingReplayHistory() async throws {
        let custody = try MacAccessPolicyCustody(
            paths: MacAccessPolicyPaths(directory: temporaryDirectory()),
            hostSessionID: "host-repair-revoked"
        )
        let envelope = actionEnvelope(commandID: "command-retained-replay")
        let burned = try await custody.burnReplay(envelope: envelope)
        XCTAssertTrue(burned)
        let revoked = try await custody.forceLocalSafety("revoke")
        XCTAssertEqual(revoked.transport, "revoked")

        let repaired = try await custody.prepareRevokedStateForFreshPairing()

        XCTAssertEqual(repaired.pairing, "unpaired")
        XCTAssertEqual(repaired.configuredMode, "off")
        XCTAssertEqual(repaired.transport, "disconnected")
        let burnedAgain = try await custody.burnReplay(envelope: envelope)
        XCTAssertFalse(burnedAgain)
    }

    func testFullAccessResumeFallbackOpensOnlyAskBarrier() async throws {
        let custody = try MacAccessPolicyCustody(
            paths: MacAccessPolicyPaths(directory: temporaryDirectory()),
            hostSessionID: "host-full-fallback"
        )
        var state = await custody.loadState()
        let revision = try XCTUnwrap(state["revision"]?.integer)
        state["pairing_state"] = .string("paired")
        state["transport_state"] = .string("connected")
        state["configured_mode"] = .string("full_access")
        state["effective_mode"] = .string("ask_every_time")
        state["paused"] = .boolean(false)
        state["kill_switch"] = .boolean(false)
        let updated = try await custody.compareAndSwap(expectedRevision: revision, state: state)
        XCTAssertTrue(updated)
        try await custody.authorizeLocalMode("full_access")
        let opened = await custody.openNativeBarrierIfAllowed()
        XCTAssertTrue(opened)
    }

    func testFullAccessPauseClearsConfirmationAndPreservesReconfirmationIntent() async throws {
        let custody = try MacAccessPolicyCustody(
            paths: MacAccessPolicyPaths(directory: temporaryDirectory()),
            hostSessionID: "host-full-pause"
        )
        var state = await custody.loadState()
        let revision = try XCTUnwrap(state["revision"]?.integer)
        state["runtime_instance_id"] = .string("runtime-full-pause")
        state["pairing_state"] = .string("paired")
        state["transport_state"] = .string("connected")
        state["configured_mode"] = .string("full_access")
        state["effective_mode"] = .string("full_access")
        state["paused"] = .boolean(false)
        state["confirmed_runtime_instance_id"] = .string("runtime-full-pause")
        state["confirmed_policy_epoch"] = state["policy_epoch"]
        state["confirmed_binding_fingerprint_sha256"] = .string(String(repeating: "b", count: 64))
        let updated = try await custody.compareAndSwap(expectedRevision: revision, state: state)
        XCTAssertTrue(updated)

        let paused = try await custody.forceLocalSafety("pause")
        let stored = await custody.loadState()

        XCTAssertTrue(paused.paused)
        XCTAssertEqual(paused.configuredMode, "full_access")
        XCTAssertEqual(paused.effectiveMode, "off")
        XCTAssertEqual(stored["local_confirmation_required"]?.boolean, true)
        XCTAssertNil(stored["confirmed_runtime_instance_id"]?.string)
        XCTAssertNil(stored["confirmed_policy_epoch"]?.integer)
        XCTAssertNil(stored["confirmed_binding_fingerprint_sha256"]?.string)
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
        let audit = try MacAccessAuditCustody(paths: paths, anchorStore: MemoryAuditAnchorStore())
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

        try FileManager.default.removeItem(
            at: paths.directory.appendingPathComponent("audit.ndjson.1")
        )
        let healthyAfterPrefixDeletion = await audit.anchorHealthy()
        XCTAssertFalse(healthyAfterPrefixDeletion)
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

    func testNativeBlockClosesBeginAfterCancelRace() async throws {
        let native = MacAccessNativeClickPort(isAccessibilityTrusted: { true })
        let actionID = try await native.begin(
            envelope: actionEnvelope(commandID: "command-before-block")
        )
        await native.blockAndCancelAll()
        _ = await native.wait(actionID: actionID)

        await XCTAssertThrowsErrorAsync {
            _ = try await native.begin(
                envelope: actionEnvelope(commandID: "command-after-block")
            )
        }
    }

    func testRunnerChannelLossLatchesKillAndQuiescesNativeWork() async throws {
        let paths = MacAccessPolicyPaths(directory: temporaryDirectory())
        let custody = try MacAccessPolicyCustody(paths: paths, hostSessionID: "host-runner-loss")
        let native = MacAccessNativeClickPort(
            performer: { _, _ in
                try? await Task.sleep(for: .seconds(30))
                return true
            },
            isAccessibilityTrusted: { true }
        )
        let dispatcher = MacAccessCoreHostPortDispatcher(
            custody: custody,
            audit: try MacAccessAuditCustody(paths: paths),
            native: native,
            vault: PolicyTestVault()
        )
        let actionID = try await native.begin(
            envelope: actionEnvelope(commandID: "command-runner-loss")
        )
        let waiter = Task { await native.wait(actionID: actionID) }

        await dispatcher.failClosedOnChannelLoss()

        let result = await waiter.value
        let projection = await custody.projectStatus()
        XCTAssertEqual(result["outcome"]?.string, "stopped")
        XCTAssertTrue(projection.killSwitch)
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

    func testStalledRunnerRequestTimesOutAndLatchesEmergencyKill() async throws {
        let paths = MacAccessPolicyPaths(directory: temporaryDirectory())
        let custody = try MacAccessPolicyCustody(paths: paths, hostSessionID: "host-timeout")
        let dispatcher = MacAccessCoreHostPortDispatcher(
            custody: custody,
            audit: try MacAccessAuditCustody(paths: paths),
            native: MacAccessNativeClickPort(isAccessibilityTrusted: { true }),
            vault: PolicyTestVault()
        )
        let channel = StalledCoreHostChannel()
        let transport = MacAccessStdioCoreHostTransport(
            launcher: { channel }, dispatcher: dispatcher,
            requestTimeout: .milliseconds(10)
        )

        await XCTAssertThrowsErrorAsync {
            _ = try await transport.request(["request_id": .string("request-timeout")])
        }

        let projection = await custody.projectStatus()
        XCTAssertTrue(projection.killSwitch)
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
        var connected = await custody.loadState()
        let revision = try XCTUnwrap(connected["revision"]?.integer)
        connected["pairing_state"] = .string("paired")
        connected["transport_state"] = .string("connected")
        connected["configured_mode"] = .string("ask_every_time")
        connected["effective_mode"] = .string("ask_every_time")
        connected["paused"] = .boolean(false)
        connected["kill_switch"] = .boolean(false)
        connected["policy_epoch"] = .integer(2)
        let updated = try await custody.compareAndSwap(expectedRevision: revision, state: connected)
        XCTAssertTrue(updated)
        try await custody.authorizeLocalMode("ask_every_time")
        await runtime.enableNativeIfAllowed()
        let execution = Task {
            await CoreHostBackedMacAccessExecutor(
                client: client, audit: audit, custody: custody
            ).execute(command: command)
        }
        while await custody.currentPendingApproval() == nil { await Task.yield() }
        let currentPending = await custody.currentPendingApproval()
        let pending = try XCTUnwrap(currentPending)
        let resolved = await custody.resolvePendingApproval(pending.approval, allow: true)
        XCTAssertTrue(resolved)
        let result = await execution.value

        XCTAssertEqual(result.outcome, .executed)
        let clickCount = await counter.count
        XCTAssertEqual(clickCount, 1)
    }

    func testHelperRejectsFabricatedTerminalAuditAndKeepsAnchorBlockedUntilExactResult() async throws {
        let paths = MacAccessPolicyPaths(directory: temporaryDirectory())
        let custody = try MacAccessPolicyCustody(paths: paths, hostSessionID: "host-audit-binding")
        let audit = try MacAccessAuditCustody(paths: paths)
        let native = MacAccessNativeClickPort(
            performer: { _, _ in true }, isAccessibilityTrusted: { true }
        )
        let dispatcher = MacAccessCoreHostPortDispatcher(
            custody: custody, audit: audit, native: native, vault: PolicyTestVault()
        )
        let envelope = actionEnvelope(commandID: "command-audit-binding")
        var state = await custody.loadState()
        let revision = try XCTUnwrap(state["revision"]?.integer)
        state["pairing_state"] = .string("paired")
        state["transport_state"] = .string("connected")
        state["configured_mode"] = .string("ask_every_time")
        state["effective_mode"] = .string("ask_every_time")
        state["paused"] = .boolean(false)
        state["kill_switch"] = .boolean(false)
        state["policy_epoch"] = .integer(2)
        let updated = try await custody.compareAndSwap(expectedRevision: revision, state: state)
        XCTAssertTrue(updated)
        try await custody.authorizeLocalMode("ask_every_time")
        let barrierOpened = await custody.openNativeBarrierIfAllowed()
        XCTAssertTrue(barrierOpened)
        try await custody.authorizeRelayAdmission(envelope: envelope)
        try await custody.authorizeNative(envelope: envelope)

        let decisionValue = try await dispatcher.handle(
            port: "audit", method: "command_decision", arguments: [
                "envelope": .object(envelope), "allowed": .boolean(true),
                "reason_code": .string("approved_exact_scope"), "detail_code": .null,
            ]
        )
        let begin = try await dispatcher.handle(
            port: "native", method: "begin", arguments: ["envelope": .object(envelope)]
        )
        let actionID = try XCTUnwrap(begin.object?["action_id"]?.string)
        _ = try await dispatcher.handle(
            port: "native", method: "wait", arguments: ["action_id": .string(actionID)]
        )
        let decision = try XCTUnwrap(decisionValue.object)

        await XCTAssertThrowsErrorAsync {
            _ = try await dispatcher.handle(
                port: "audit", method: "command_result", arguments: [
                    "envelope": .object(envelope), "decision": .object(decision),
                    "outcome": .string("failed"),
                    "reason_code": .string("approved_exact_scope"),
                    "detail_code": .string("actuation_failed"),
                ]
            )
        }
        let blocked = try await dispatcher.handle(
            port: "audit", method: "anchor_healthy", arguments: [:]
        )
        XCTAssertEqual(blocked.boolean, false)

        let terminalValue = try await dispatcher.handle(
            port: "audit", method: "command_result", arguments: [
                "envelope": .object(envelope), "decision": .object(decision),
                "outcome": .string("executed"),
                "reason_code": .string("approved_exact_scope"),
                "detail_code": .string("actuation_succeeded"),
            ]
        )
        let resultAuditID = try XCTUnwrap(terminalValue.object?["audit_id"]?.string)
        let resultCommitted = await audit.containsCommittedAuditID(resultAuditID)
        XCTAssertTrue(resultCommitted)
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
        XCTAssertEqual(arguments.dropFirst().first, "-B")
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
            "binding": .object([
                "binding_fingerprint_sha256": .string(String(repeating: "b", count: 64)),
                "device_id": .string("mac-01"),
            ]),
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
