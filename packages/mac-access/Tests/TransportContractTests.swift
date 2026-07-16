import CryptoKit
import Foundation
import XCTest

private struct SignedCommandFixture: Sendable {
    let now: Date
    let binding: MacAccessSelectedBinding
    let command: MacAccessBrokerCommand
    let wire: Data
    let keys: MacAccessPinnedKeys
    let commandPrivateKey: Curve25519.Signing.PrivateKey
    let contextPrivateKey: Curve25519.Signing.PrivateKey
}

private func makeSignedCommandFixture(
    binding suppliedBinding: MacAccessSelectedBinding? = nil,
    contextIDBytes: Int = 16
) throws -> SignedCommandFixture {
    let formatter = ISO8601DateFormatter()
    let now = try XCTUnwrap(formatter.date(from: "2026-07-15T08:01:15Z"))
    let commandKey = Curve25519.Signing.PrivateKey()
    let contextKey = Curve25519.Signing.PrivateKey()
    let binding = suppliedBinding ?? MacAccessSelectedBinding(
        customerID: "customer-01", customerVMID: "vm-01", deviceID: "mac-01",
        grantID: "grant-01", runtime: "openclaw", bindingID: "binding-01",
        bindingVersion: "v3", grantExpiresAt: "2026-07-15T09:00:00Z",
        connectorInstallationID: "install-01", connectorKeyID: "mac-key-01",
        bindingFingerprintSHA256: String(repeating: "1", count: 64)
    )
    let claims = MacAccessExecutionContextClaims(
        schemaVersion: "evaos.mac_control_execution_context.v1",
        keyID: "context-key-01",
        runtime: binding.runtime,
        customerID: binding.customerID,
        customerVMID: binding.customerVMID,
        bindingID: binding.bindingID,
        bindingVersion: binding.bindingVersion,
        issuedAt: Int64(now.timeIntervalSince1970) - 60,
        expiresAt: Int64(now.timeIntervalSince1970) + 120,
        contextID: MacAccessWire.base64URL(Data(repeating: 0x3c, count: contextIDBytes))
    )
    let contextPayload = try MacAccessWire.canonicalData(claims)
    let context = MacAccessExecutionContext(
        claims: claims,
        payloadBase64URL: MacAccessWire.base64URL(contextPayload),
        payloadSHA256: MacAccessWire.sha256Hex(contextPayload),
        signatureBase64URL: MacAccessWire.base64URL(try contextKey.signature(for: contextPayload)),
        keyID: claims.keyID
    )
    let request: [String: JSONValue] = ["button": .string("left"), "x": .integer(120), "y": .integer(240)]
    let requestDigest = MacAccessWire.sha256Hex(try MacAccessWire.canonicalData(for: request))
    let body = MacAccessCommandBody(
        capability: "customer_mac.desktop_click",
        request: request,
        requestDigestSHA256: requestDigest
    )
    let issuedAt = formatter.string(from: now.addingTimeInterval(-1))
    let expiresAt = formatter.string(from: now.addingTimeInterval(30))
    let payload = MacAccessCommandAuthorityPayload(
        schemaVersion: "evaos.mac_access.command_authority_payload.v1",
        domain: "evaos.mac-access/command-authority/v1",
        sessionID: "session-01",
        channelGenerationID: "channel-generation-01",
        commandID: "command-01",
        issuedAt: issuedAt,
        expiresAt: expiresAt,
        sequence: 42,
        policyEpoch: 7,
        nonce: MacAccessWire.base64URL(Data("broker-nonce-01".utf8)),
        binding: binding,
        executionContextSHA256: context.payloadSHA256,
        capability: body.capability,
        requestDigestSHA256: requestDigest
    )
    let canonicalPayload = try MacAccessWire.canonicalData(payload)
    let authorization = MacAccessCommandAuthorization(
        schemaVersion: "evaos.mac_access.command_authorization.v1",
        canonicalization: "RFC8785-JCS",
        payload: payload,
        payloadSHA256: MacAccessWire.sha256Hex(canonicalPayload),
        keyID: "command-key-01",
        signatureBase64URL: MacAccessWire.base64URL(try commandKey.signature(for: canonicalPayload))
    )
    let command = MacAccessBrokerCommand(
        schemaVersion: "evaos.mac_access.broker_control.v1",
        messageType: "command",
        sessionID: payload.sessionID,
        channelGenerationID: payload.channelGenerationID,
        commandID: payload.commandID,
        issuedAt: issuedAt,
        expiresAt: expiresAt,
        sequence: payload.sequence,
        policyEpoch: payload.policyEpoch,
        nonce: payload.nonce,
        binding: binding,
        executionContext: context,
        command: body,
        authorization: authorization
    )
    return SignedCommandFixture(
        now: now,
        binding: binding,
        command: command,
        wire: try MacAccessWire.canonicalData(command),
        keys: MacAccessPinnedKeys(
            commandKeyID: authorization.keyID,
            commandPublicKey: commandKey.publicKey.rawRepresentation,
            executionContextPublicKeys: [claims.keyID: contextKey.publicKey.rawRepresentation]
        ),
        commandPrivateKey: commandKey,
        contextPrivateKey: contextKey
    )
}

private func replacing(
    _ command: MacAccessBrokerCommand,
    body: MacAccessCommandBody? = nil,
    authorization: MacAccessCommandAuthorization? = nil
) -> MacAccessBrokerCommand {
    MacAccessBrokerCommand(
        schemaVersion: command.schemaVersion,
        messageType: command.messageType,
        sessionID: command.sessionID,
        channelGenerationID: command.channelGenerationID,
        commandID: command.commandID,
        issuedAt: command.issuedAt,
        expiresAt: command.expiresAt,
        sequence: command.sequence,
        policyEpoch: command.policyEpoch,
        nonce: command.nonce,
        binding: command.binding,
        executionContext: command.executionContext,
        command: body ?? command.command,
        authorization: authorization ?? command.authorization
    )
}

private func makeNextSignedCommandFixture(after fixture: SignedCommandFixture) throws -> SignedCommandFixture {
    let old = fixture.command
    let claims = MacAccessExecutionContextClaims(
        schemaVersion: old.executionContext.claims.schemaVersion,
        keyID: old.executionContext.claims.keyID,
        runtime: old.binding.runtime,
        customerID: old.binding.customerID,
        customerVMID: old.binding.customerVMID,
        bindingID: old.binding.bindingID,
        bindingVersion: old.binding.bindingVersion,
        issuedAt: old.executionContext.claims.issuedAt,
        expiresAt: old.executionContext.claims.expiresAt,
        contextID: MacAccessWire.base64URL(Data(repeating: 0x4d, count: 16))
    )
    let contextPayload = try MacAccessWire.canonicalData(claims)
    let context = MacAccessExecutionContext(
        claims: claims,
        payloadBase64URL: MacAccessWire.base64URL(contextPayload),
        payloadSHA256: MacAccessWire.sha256Hex(contextPayload),
        signatureBase64URL: MacAccessWire.base64URL(
            try fixture.contextPrivateKey.signature(for: contextPayload)
        ),
        keyID: claims.keyID
    )
    let request: [String: JSONValue] = [
        "button": .string("left"), "x": .integer(121), "y": .integer(241),
    ]
    let requestDigest = MacAccessWire.sha256Hex(try MacAccessWire.canonicalData(for: request))
    let body = MacAccessCommandBody(
        capability: old.command.capability,
        request: request,
        requestDigestSHA256: requestDigest
    )
    let payload = MacAccessCommandAuthorityPayload(
        schemaVersion: old.authorization.payload.schemaVersion,
        domain: old.authorization.payload.domain,
        sessionID: old.sessionID,
        channelGenerationID: old.channelGenerationID,
        commandID: "command-02",
        issuedAt: old.issuedAt,
        expiresAt: old.expiresAt,
        sequence: old.sequence + 1,
        policyEpoch: old.policyEpoch,
        nonce: MacAccessWire.base64URL(Data("broker-nonce-02".utf8)),
        binding: old.binding,
        executionContextSHA256: context.payloadSHA256,
        capability: body.capability,
        requestDigestSHA256: requestDigest
    )
    let canonicalPayload = try MacAccessWire.canonicalData(payload)
    let authorization = MacAccessCommandAuthorization(
        schemaVersion: old.authorization.schemaVersion,
        canonicalization: old.authorization.canonicalization,
        payload: payload,
        payloadSHA256: MacAccessWire.sha256Hex(canonicalPayload),
        keyID: old.authorization.keyID,
        signatureBase64URL: MacAccessWire.base64URL(
            try fixture.commandPrivateKey.signature(for: canonicalPayload)
        )
    )
    let command = MacAccessBrokerCommand(
        schemaVersion: old.schemaVersion,
        messageType: old.messageType,
        sessionID: payload.sessionID,
        channelGenerationID: payload.channelGenerationID,
        commandID: payload.commandID,
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
        sequence: payload.sequence,
        policyEpoch: payload.policyEpoch,
        nonce: payload.nonce,
        binding: payload.binding,
        executionContext: context,
        command: body,
        authorization: authorization
    )
    return SignedCommandFixture(
        now: fixture.now,
        binding: fixture.binding,
        command: command,
        wire: try MacAccessWire.canonicalData(command),
        keys: fixture.keys,
        commandPrivateKey: fixture.commandPrivateKey,
        contextPrivateKey: fixture.contextPrivateKey
    )
}

private actor MemoryCredentialVault: MacAccessCredentialVault {
    private var record: MacAccessCredentialRecord?
    private(set) var eraseCount = 0
    private(set) var saveCount = 0
    private let failErase: Bool

    init(_ record: MacAccessCredentialRecord?, failErase: Bool = false) {
        self.record = record
        self.failErase = failErase
    }
    func load() -> MacAccessCredentialRecord? { record }
    func save(_ record: MacAccessCredentialRecord) { self.record = record; saveCount += 1 }
    func erase() throws {
        eraseCount += 1
        if failErase { throw CocoaError(.fileWriteNoPermission) }
        record = nil
    }

    func waitUntilErased() async {
        while record != nil { await Task.yield() }
    }
}

private actor QueuedRelaySocket: MacAccessRelaySocket {
    private var received: [Data]
    private var receivers: [CheckedContinuation<Data, any Error>] = []
    private(set) var sent: [Data] = []
    private(set) var isClosed = false

    init(received: [Data]) { self.received = received }
    func send(_ data: Data) { sent.append(data) }
    func receive() async throws -> Data {
        if !received.isEmpty { return received.removeFirst() }
        return try await withCheckedThrowingContinuation { receivers.append($0) }
    }
    func close() {
        isClosed = true
        let pending = receivers
        receivers.removeAll()
        for receiver in pending { receiver.resume(throwing: MacAccessPublicError.stopped) }
    }
}

private struct FixtureSocketFactory: MacAccessRelaySocketFactory {
    let socket: QueuedRelaySocket
    func open(url: URL) async throws -> any MacAccessRelaySocket {
        guard url.scheme == "wss", url.path == MacAccessWire.relayPath else {
            throw MacAccessPublicError.relayUnavailable
        }
        return socket
    }
}

private actor ControlledRelaySocket: MacAccessRelaySocket {
    private var received: [Data]
    private var receivers: [CheckedContinuation<Data, any Error>] = []
    private(set) var sent: [Data] = []
    private(set) var closeCount = 0
    private let suspendClose: Bool
    private var closeContinuations: [CheckedContinuation<Void, Never>] = []

    init(received: [Data], suspendClose: Bool = false) {
        self.received = received
        self.suspendClose = suspendClose
    }

    func send(_ data: Data) { sent.append(data) }

    func receive() async throws -> Data {
        if !received.isEmpty { return received.removeFirst() }
        return try await withCheckedThrowingContinuation { receivers.append($0) }
    }

    func close() async {
        closeCount += 1
        if suspendClose {
            await withCheckedContinuation { closeContinuations.append($0) }
        }
    }

    func waitUntilReceiving() async {
        while receivers.isEmpty { await Task.yield() }
    }

    func waitUntilSentCount(_ expectedCount: Int) async {
        while sent.count < expectedCount { await Task.yield() }
    }

    func waitUntilClosing() async {
        while closeContinuations.isEmpty { await Task.yield() }
    }

    func waitUntilCloseCount(_ expectedCount: Int) async {
        while closeCount < expectedCount { await Task.yield() }
    }

    func releaseClose() {
        guard !closeContinuations.isEmpty else { return }
        closeContinuations.removeFirst().resume()
    }

    func deliver(_ data: Data) {
        if receivers.isEmpty {
            received.append(data)
        } else {
            receivers.removeFirst().resume(returning: data)
        }
    }
}

private actor SequencedSocketFactory: MacAccessRelaySocketFactory {
    private var sockets: [ControlledRelaySocket]
    private(set) var openCount = 0

    init(_ sockets: [ControlledRelaySocket]) { self.sockets = sockets }

    func open(url: URL) throws -> any MacAccessRelaySocket {
        guard url.scheme == "wss", url.path == MacAccessWire.relayPath, !sockets.isEmpty else {
            throw MacAccessPublicError.relayUnavailable
        }
        openCount += 1
        return sockets.removeFirst()
    }
}

private actor CountingExecutor: MacAccessCommandExecutor {
    private(set) var executionCount = 0

    func execute(command _: MacAccessBrokerCommand) -> MacAccessExecutionResult {
        executionCount += 1
        return MacAccessExecutionResult(localAuditID: "counting-audit-\(executionCount)", outcome: .executed)
    }
}

private actor SuspendedExecutor: MacAccessCommandExecutor {
    private var continuation: CheckedContinuation<MacAccessExecutionResult, Never>?
    private var started = false

    func execute(command _: MacAccessBrokerCommand) async -> MacAccessExecutionResult {
        started = true
        return await withCheckedContinuation { continuation = $0 }
    }

    func waitUntilExecuting() async {
        while !started { await Task.yield() }
    }

    func release() {
        continuation?.resume(
            returning: MacAccessExecutionResult(
                localAuditID: "suspended-audit-01", outcome: .executed
            )
        )
        continuation = nil
    }
}

private actor RecordingTransportSafetySink: MacAccessTransportSafetySink {
    private(set) var events: [MacAccessTransportSafetyEvent] = []
    func preemptTransportSafety(_ event: MacAccessTransportSafetyEvent) {
        events.append(event)
    }

    func waitUntilEventCount(_ expectedCount: Int) async {
        while events.count < expectedCount { await Task.yield() }
    }
}

private actor SuspendedTransportSafetySink: MacAccessTransportSafetySink {
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var events: [MacAccessTransportSafetyEvent] = []

    func preemptTransportSafety(_ event: MacAccessTransportSafetyEvent) async {
        events.append(event)
        await withCheckedContinuation { continuation = $0 }
    }

    func waitUntilSuspended() async {
        while continuation == nil { await Task.yield() }
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}

private actor ControlledExpirySleeper {
    private var continuations: [CheckedContinuation<Void, any Error>] = []

    func sleep(for _: TimeInterval) async throws {
        try await withCheckedThrowingContinuation { continuations.append($0) }
    }

    func waitUntilSleeping() async {
        while continuations.isEmpty { await Task.yield() }
    }

    func release() {
        guard !continuations.isEmpty else { return }
        continuations.removeFirst().resume()
    }
}

private final class TransportTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date
    init(_ value: Date) { self.value = value }
    func now() -> Date { lock.withLock { value } }
    func advance(_ interval: TimeInterval) { lock.withLock { value.addTimeInterval(interval) } }
}

private actor FixturePairingRedeemer: MacAccessPairingRedeemer {
    private let bindingID: String
    private let mismatchIdentity: Bool
    private(set) var lastRequest: MacAccessPairingRedemptionRequest?

    init(bindingID: String = "binding-paired", mismatchIdentity: Bool = false) {
        self.bindingID = bindingID
        self.mismatchIdentity = mismatchIdentity
    }

    func redeem(
        _ request: MacAccessPairingRedemptionRequest,
        now: Date
    ) -> MacAccessPairingRedemptionResponse {
        lastRequest = request
        return pairingResponse(
            for: request.proof, bindingID: bindingID, mismatchIdentity: mismatchIdentity
        )
    }
}

private actor SuspendedThenSuccessfulRedeemer: MacAccessPairingRedeemer {
    private var continuation: CheckedContinuation<MacAccessPairingRedemptionResponse, any Error>?
    private var firstProof: MacAccessPairingProof?
    private var didSuspend = false

    func redeem(
        _ request: MacAccessPairingRedemptionRequest,
        now: Date
    ) async throws -> MacAccessPairingRedemptionResponse {
        if !didSuspend {
            didSuspend = true
            firstProof = request.proof
            return try await withCheckedThrowingContinuation { continuation = $0 }
        }
        return pairingResponse(for: request.proof, bindingID: "binding-after-disconnect")
    }

    func waitUntilSuspended() async {
        while continuation == nil { await Task.yield() }
    }

    func releaseFirst() {
        guard let firstProof else { return }
        continuation?.resume(returning: pairingResponse(for: firstProof, bindingID: "binding-stale"))
        continuation = nil
    }
}

private func pairingResponse(
    for proof: MacAccessPairingProof,
    bindingID: String,
    mismatchIdentity: Bool = false
) -> MacAccessPairingRedemptionResponse {
    MacAccessPairingRedemptionResponse(
        ok: true,
        schemaVersion: "evaos.mac_access.pairing_redeem_response.v1",
        selectedBinding: MacAccessSelectedBinding(
            customerID: "customer-paired", customerVMID: "vm-paired", deviceID: "mac-paired",
            grantID: "grant-paired", runtime: "openclaw", bindingID: bindingID,
            bindingVersion: "v1", grantExpiresAt: "2030-01-02T03:04:05.000Z",
            connectorInstallationID: mismatchIdentity ? "wrong-installation" : proof.connectorInstallationID,
            connectorKeyID: mismatchIdentity ? "wrong-key" : proof.connectorKeyID,
            bindingFingerprintSHA256: String(repeating: "b", count: 64)
        ),
        relayCredential: "opaque-paired-credential",
        relayCredentialExpiresAt: "2030-01-02T03:04:05.000Z",
        auditID: "pairing-audit-new"
    )
}

private struct UnusedRedeemer: MacAccessPairingRedeemer {
    func redeem(_ request: MacAccessPairingRedemptionRequest, now: Date) async throws -> MacAccessPairingRedemptionResponse {
        throw MacAccessPublicError.pairingRejected
    }
}

private struct FixtureExecutor: MacAccessCommandExecutor {
    func execute(command _: MacAccessBrokerCommand) async -> MacAccessExecutionResult {
        MacAccessExecutionResult(localAuditID: "fixture-audit-01", outcome: .executed)
    }
}

final class TransportContractTests: XCTestCase {
    func testCommandAuthorityGoldenParity() throws {
        let fixture = try makeSignedCommandFixture()
        let payload = MacAccessCommandAuthorityPayload(
            schemaVersion: "evaos.mac_access.command_authority_payload.v1",
            domain: "evaos.mac-access/command-authority/v1",
            sessionID: "session-01", channelGenerationID: "channel-generation-01",
            commandID: "command-01", issuedAt: "2026-07-15T08:01:00Z",
            expiresAt: "2026-07-15T08:01:45Z", sequence: 42, policyEpoch: 7,
            nonce: "YnJva2VyLW5vbmNlLTAx", binding: fixture.binding,
            executionContextSHA256: String(repeating: "9", count: 64),
            capability: "customer_mac.desktop_click",
            requestDigestSHA256: String(repeating: "d", count: 64)
        )
        let expected = #"{"binding":{"binding_fingerprint_sha256":"1111111111111111111111111111111111111111111111111111111111111111","binding_id":"binding-01","binding_version":"v3","connector_installation_id":"install-01","connector_key_id":"mac-key-01","customer_id":"customer-01","customer_vm_id":"vm-01","device_id":"mac-01","grant_expires_at":"2026-07-15T09:00:00Z","grant_id":"grant-01","runtime":"openclaw"},"capability":"customer_mac.desktop_click","channel_generation_id":"channel-generation-01","command_id":"command-01","domain":"evaos.mac-access/command-authority/v1","execution_context_sha256":"9999999999999999999999999999999999999999999999999999999999999999","expires_at":"2026-07-15T08:01:45Z","issued_at":"2026-07-15T08:01:00Z","nonce":"YnJva2VyLW5vbmNlLTAx","policy_epoch":7,"request_digest_sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","schema_version":"evaos.mac_access.command_authority_payload.v1","sequence":42,"session_id":"session-01"}"#
        let canonical = try MacAccessWire.canonicalData(payload)
        XCTAssertEqual(canonical, Data(expected.utf8))
        XCTAssertEqual(MacAccessWire.sha256Hex(canonical), "fb84c2148a0badf2eb45d44d5b61ef0e4b9dea1951d04d1686aaebd8cd214088")

        let spki = try MacAccessWire.decodeBase64URL("MCowBQYDK2VwAyEAWO51w0MazRnvueU-WV5vdxiMNOdxdyy2BSqNDNgky3E")
        let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: Data(spki.suffix(32)))
        XCTAssertTrue(publicKey.isValidSignature(
            try MacAccessWire.decodeBase64URL("oNz1ORiixjkjMJDtoidzZJh3BL1QyAIRBgEPjpcRiLMdsmlZWhoQSfQ3ZqepamtpEWOCreYcyRWqIpqwLTggCg"),
            for: canonical
        ))
    }

    func testValidCommandAndNegativeAuthorityCases() throws {
        let fixture = try makeSignedCommandFixture()
        let verifier = MacAccessCommandVerifier(keys: fixture.keys)
        XCTAssertNoThrow(try verifier.decodeAndVerify(
            fixture.wire, expectedBinding: fixture.binding,
            expectedSessionID: "session-01", expectedChannelGenerationID: "channel-generation-01",
            now: fixture.now
        ))

        let wrongBinding = MacAccessSelectedBinding(
            customerID: fixture.binding.customerID, customerVMID: fixture.binding.customerVMID,
            deviceID: "different-mac", grantID: fixture.binding.grantID, runtime: fixture.binding.runtime,
            bindingID: fixture.binding.bindingID, bindingVersion: fixture.binding.bindingVersion,
            grantExpiresAt: fixture.binding.grantExpiresAt,
            connectorInstallationID: fixture.binding.connectorInstallationID,
            connectorKeyID: fixture.binding.connectorKeyID,
            bindingFingerprintSHA256: fixture.binding.bindingFingerprintSHA256
        )
        assertError(.wrongBinding) {
            try verifier.decodeAndVerify(fixture.wire, expectedBinding: wrongBinding,
                expectedSessionID: "session-01", expectedChannelGenerationID: "channel-generation-01", now: fixture.now)
        }

        let badAuthorization = MacAccessCommandAuthorization(
            schemaVersion: fixture.command.authorization.schemaVersion,
            canonicalization: fixture.command.authorization.canonicalization,
            payload: fixture.command.authorization.payload,
            payloadSHA256: fixture.command.authorization.payloadSHA256,
            keyID: fixture.command.authorization.keyID,
            signatureBase64URL: MacAccessWire.base64URL(Data(repeating: 0, count: 64))
        )
        assertError(.signatureMismatch) {
            let wire = try MacAccessWire.canonicalData(replacing(fixture.command, authorization: badAuthorization))
            _ = try verifier.decodeAndVerify(wire, expectedBinding: fixture.binding,
                expectedSessionID: "session-01", expectedChannelGenerationID: "channel-generation-01", now: fixture.now)
        }

        let changedBody = MacAccessCommandBody(
            capability: fixture.command.command.capability,
            request: ["x": .integer(999)],
            requestDigestSHA256: fixture.command.command.requestDigestSHA256
        )
        assertError(.digestMismatch) {
            let wire = try MacAccessWire.canonicalData(replacing(fixture.command, body: changedBody))
            _ = try verifier.decodeAndVerify(wire, expectedBinding: fixture.binding,
                expectedSessionID: "session-01", expectedChannelGenerationID: "channel-generation-01", now: fixture.now)
        }
        assertError(.expiredAuthority) {
            try verifier.decodeAndVerify(fixture.wire, expectedBinding: fixture.binding,
                expectedSessionID: "session-01", expectedChannelGenerationID: "channel-generation-01",
                now: fixture.now.addingTimeInterval(31))
        }

        for invalidContextIDBytes in [15, 17] {
            let invalidFixture = try makeSignedCommandFixture(contextIDBytes: invalidContextIDBytes)
            let invalidVerifier = MacAccessCommandVerifier(keys: invalidFixture.keys)
            assertError(.expiredAuthority) {
                try invalidVerifier.decodeAndVerify(
                    invalidFixture.wire,
                    expectedBinding: invalidFixture.binding,
                    expectedSessionID: "session-01",
                    expectedChannelGenerationID: "channel-generation-01",
                    now: invalidFixture.now
                )
            }
        }

        var replay = MacAccessReplayWindow()
        try replay.accept(fixture.command)
        assertError(.replayRejected) { try replay.accept(fixture.command) }
    }

    func testRFC8785NumericGoldenAndStrictUnicode() throws {
        let numeric = Data(#"{"numbers":[333333333.33333329,1E30,4.50,2e-3,1e-27]}"#.utf8)
        let decoded = try MacAccessWire.decodeStrict([String: JSONValue].self, from: numeric)
        XCTAssertEqual(
            try MacAccessWire.canonicalData(decoded),
            Data(#"{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}"#.utf8)
        )
        let strings: [String: JSONValue] = [
            "€": .integer(2), "a": .string("\u{8}\t\n\u{c}\r\"\\/"), "\r": .integer(3),
        ]
        XCTAssertEqual(
            try MacAccessWire.canonicalData(strings),
            Data(#"{"\r":3,"a":"\b\t\n\f\r\"\\/","€":2}"#.utf8)
        )
        XCTAssertNoThrow(try MacAccessWire.strictJSONObject(from: Data(#"{"value":"\uD83D\uDE00","counter":9007199254740991}"#.utf8)))
        XCTAssertNoThrow(try MacAccessWire.strictJSONObject(from: Data(#"{"value":"\\uD800"}"#.utf8)))
        XCTAssertNoThrow(try MacAccessWire.strictJSONObject(from: Data(#"{"counter":9007199254740992,"fraction":1.5}"#.utf8)))
        for raw in [#"{"value":"\uD800"}"#, #"{"value":"\uDC00"}"#, #"{"value":"\uD800x"}"#] {
            assertError(.invalidUnicode) { _ = try MacAccessWire.strictJSONObject(from: Data(raw.utf8)) }
        }
    }

    func testOutboundWebSocketPayloadRequiresUTF8Text() throws {
        let canonical = try MacAccessWire.canonicalData(["ok": JSONValue.boolean(true)])
        XCTAssertEqual(try MacAccessWire.webSocketText(from: canonical), #"{"ok":true}"#)
        assertError(.invalidWireMessage) {
            _ = try MacAccessWire.webSocketText(from: Data([0xff]))
        }
    }

    func testDuplicateMemberIdentityUsesExactDecodedUTF16CodeUnits() throws {
        let composedAndDecomposed = Data(#"{"é":1,"e\u0301":2}"#.utf8)
        XCTAssertNoThrow(try MacAccessWire.strictJSONObject(from: composedAndDecomposed))

        let escapedASCIIEquivalent = Data(#"{"x":1,"\u0078":2}"#.utf8)
        assertError(.invalidWireMessage) {
            _ = try MacAccessWire.strictJSONObject(from: escapedASCIIEquivalent)
        }

        let decomposed = "e\u{301}"
        let rawAndEscapedEquivalent = Data("{\"\(decomposed)\":1,\"e\\u0301\":2}".utf8)
        assertError(.invalidWireMessage) {
            _ = try MacAccessWire.strictJSONObject(from: rawAndEscapedEquivalent)
        }
    }

    func testFixtureExecutorRoundTripThenStopPreservesPairingAndCloses() async throws {
        let fixture = try makeSignedCommandFixture()
        let ack = MacAccessRelayRegistrationAck(
            schemaVersion: "evaos.mac_access.relay_registration_ack.v1",
            messageType: "registration_ack", sessionID: "session-01",
            channelGenerationID: "channel-generation-01"
        )
        let socket = QueuedRelaySocket(received: [try MacAccessWire.canonicalData(ack), fixture.wire])
        let vault = MemoryCredentialVault(credentialRecord(for: fixture))
        let runtime = MacAccessHelperRuntime(
            vault: vault, redeemer: UnusedRedeemer(), socketFactory: FixtureSocketFactory(socket: socket),
            executor: FixtureExecutor(), pinnedKeys: fixture.keys,
            relayURL: try XCTUnwrap(URL(string: "wss://relay.example.test/mac-access-relay/v1")),
            now: { fixture.now }
        )

        let connected = try await runtime.connect()
        XCTAssertEqual(connected.transport, .connected)
        let receipt = try await runtime.processOneCommand()
        XCTAssertEqual(receipt.outcome, .executed)
        XCTAssertEqual(receipt.localAuditID, "fixture-audit-01")
        let sent = await socket.sent
        XCTAssertEqual(sent.count, 2)
        XCTAssertEqual(try MacAccessWire.decodeStrict(MacAccessRelayReceipt.self, from: sent[1]), receipt)

        let stopped = try await runtime.stop()
        let preservedRecord = await vault.load()
        let eraseCount = await vault.eraseCount
        let isClosed = await socket.isClosed
        XCTAssertEqual(stopped.transport, .stopped)
        XCTAssertEqual(stopped.pairing, .paired)
        XCTAssertNotNil(preservedRecord)
        XCTAssertEqual(eraseCount, 0)
        XCTAssertTrue(isClosed)
    }

    func testReplayHistorySurvivesDisconnectAndReconnect() async throws {
        let fixture = try makeSignedCommandFixture()
        let ack = MacAccessRelayRegistrationAck(
            schemaVersion: "evaos.mac_access.relay_registration_ack.v1",
            messageType: "registration_ack", sessionID: "session-01",
            channelGenerationID: "channel-generation-01"
        )
        let first = ControlledRelaySocket(received: [try MacAccessWire.canonicalData(ack), fixture.wire])
        let second = ControlledRelaySocket(received: [try MacAccessWire.canonicalData(ack), fixture.wire])
        let executor = CountingExecutor()
        let runtime = MacAccessHelperRuntime(
            vault: MemoryCredentialVault(credentialRecord(for: fixture)),
            redeemer: UnusedRedeemer(), socketFactory: SequencedSocketFactory([first, second]),
            executor: executor, pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )

        _ = try await runtime.connect()
        _ = try await runtime.processOneCommand()
        _ = await runtime.disconnect()
        _ = try await runtime.connect()
        do {
            _ = try await runtime.processOneCommand()
            XCTFail("expected replay rejection")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .replayRejected)
        }

        let executionCount = await executor.executionCount
        XCTAssertEqual(executionCount, 1)
        let secondSent = await second.sent
        XCTAssertEqual(secondSent.count, 1)
    }

    func testRemoteRevokeReasonMatrixErasesOnlyGrantRevoked() async throws {
        for reason in ["grant_revoked", "local_stop", "reconnected", "relay_closed"] {
            let fixture = try makeSignedCommandFixture()
            let revoke = MacAccessRelayRevoke(
                schemaVersion: "evaos.mac_access.relay_revoke.v1", messageType: "revoke",
                sessionID: "session-01", channelGenerationID: "channel-generation-01",
                binding: fixture.binding, reasonCode: reason, sequence: 43
            )
            let first = ControlledRelaySocket(received: [
                try MacAccessWire.canonicalData(registrationAck()),
                fixture.wire,
            ])
            let second = ControlledRelaySocket(received: [
                try MacAccessWire.canonicalData(registrationAck()), fixture.wire,
            ])
            let vault = MemoryCredentialVault(credentialRecord(for: fixture))
            let executor = CountingExecutor()
            let safetySink = RecordingTransportSafetySink()
            let runtime = MacAccessHelperRuntime(
                vault: vault, redeemer: UnusedRedeemer(),
                socketFactory: SequencedSocketFactory([first, second]), executor: executor,
                safetySink: safetySink, pinnedKeys: fixture.keys,
                relayURL: try relayURL(), now: { fixture.now }
            )

            _ = try await runtime.connect()
            _ = try await runtime.processOneCommand()
            await first.deliver(try MacAccessWire.canonicalData(revoke))
            await safetySink.waitUntilEventCount(1)

            let terminalStatus = await runtime.status
            if reason == "grant_revoked" { await vault.waitUntilErased() }
            let record = await vault.load()
            let safetyEvents = await safetySink.events
            XCTAssertEqual(
                safetyEvents,
                [reason == "grant_revoked" ? .grantRevoked : .channelClosed]
            )
            if reason == "grant_revoked" {
                XCTAssertEqual(terminalStatus.pairing, .revoked)
                XCTAssertNil(record)
                continue
            }
            XCTAssertEqual(terminalStatus.pairing, .paired)
            XCTAssertEqual(
                terminalStatus.transport, reason == "local_stop" ? .disconnected : .blocked
            )
            XCTAssertNotNil(record)

            _ = try await runtime.connect()
            do {
                _ = try await runtime.processOneCommand()
                XCTFail("expected replay rejection after \(reason)")
            } catch {
                XCTAssertEqual(error as? MacAccessPublicError, .replayRejected)
            }
            let executionCount = await executor.executionCount
            XCTAssertEqual(executionCount, 1)
        }
    }

    func testStaleReceiverCannotCloseNewChannelAndStopClosesActiveSocket() async throws {
        let fixture = try makeSignedCommandFixture()
        let ack = MacAccessRelayRegistrationAck(
            schemaVersion: "evaos.mac_access.relay_registration_ack.v1",
            messageType: "registration_ack", sessionID: "session-01",
            channelGenerationID: "channel-generation-01"
        )
        let first = ControlledRelaySocket(received: [try MacAccessWire.canonicalData(ack)])
        let second = ControlledRelaySocket(received: [try MacAccessWire.canonicalData(ack)])
        let vault = MemoryCredentialVault(credentialRecord(for: fixture))
        let executor = CountingExecutor()
        let runtime = MacAccessHelperRuntime(
            vault: vault, redeemer: UnusedRedeemer(), socketFactory: SequencedSocketFactory([first, second]),
            executor: executor, pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )

        _ = try await runtime.connect()
        let oldReceiver = Task { try await runtime.processOneCommand() }
        await first.waitUntilReceiving()
        _ = await runtime.disconnect()
        _ = try await runtime.connect()
        await first.deliver(fixture.wire)
        do {
            _ = try await oldReceiver.value
            XCTFail("expected stale receiver rejection")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .stopped)
        }

        let statusBeforeStop = await runtime.status
        let secondCloseCountBeforeStop = await second.closeCount
        XCTAssertEqual(statusBeforeStop.transport, .connected)
        XCTAssertEqual(secondCloseCountBeforeStop, 0)
        _ = try await runtime.stop()
        let secondCloseCount = await second.closeCount
        let record = await vault.load()
        XCTAssertEqual(secondCloseCount, 1)
        XCTAssertNotNil(record)
    }

    func testDirectReconnectFailsOldCommandWaiterBeforeNewGenerationStarts() async throws {
        let fixture = try makeSignedCommandFixture()
        let first = ControlledRelaySocket(received: [
            try MacAccessWire.canonicalData(registrationAck()),
        ])
        let second = ControlledRelaySocket(received: [
            try MacAccessWire.canonicalData(registrationAck()), fixture.wire,
        ])
        let runtime = MacAccessHelperRuntime(
            vault: MemoryCredentialVault(credentialRecord(for: fixture)),
            redeemer: UnusedRedeemer(),
            socketFactory: SequencedSocketFactory([first, second]),
            executor: FixtureExecutor(),
            pinnedKeys: fixture.keys,
            relayURL: try relayURL(),
            now: { fixture.now }
        )

        _ = try await runtime.connect()
        let oldWaiter = Task { try await runtime.processOneCommand() }
        for _ in 0..<10 { await Task.yield() }

        _ = try await runtime.connect()
        do {
            _ = try await oldWaiter.value
            XCTFail("expected old-generation waiter to be failed")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .stopped)
        }

        let receipt = try await runtime.processOneCommand()
        let secondSent = await second.sent
        XCTAssertEqual(receipt.commandID, "command-01")
        XCTAssertEqual(secondSent.count, 2)
    }

    func testSuspendedOldCloseCannotOverwriteNewConnectedChannel() async throws {
        let fixture = try makeSignedCommandFixture()
        let first = ControlledRelaySocket(
            received: [
                try MacAccessWire.canonicalData(registrationAck()),
                Data(#"{"message_type":"bogus"}"#.utf8),
            ],
            suspendClose: true
        )
        let second = ControlledRelaySocket(received: [try MacAccessWire.canonicalData(registrationAck())])
        let runtime = MacAccessHelperRuntime(
            vault: MemoryCredentialVault(credentialRecord(for: fixture)),
            redeemer: UnusedRedeemer(), socketFactory: SequencedSocketFactory([first, second]),
            pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )

        _ = try await runtime.connect()
        let oldCompletion = Task { try await runtime.processOneCommand() }
        await first.waitUntilClosing()
        do {
            _ = try await runtime.connect()
            XCTFail("expected reconnect to wait for old channel safety closure")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .credentialUnavailable)
        }
        await first.releaseClose()
        for _ in 0..<20 { await Task.yield() }
        _ = try await runtime.connect()
        do {
            _ = try await oldCompletion.value
            XCTFail("expected old receiver failure")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .invalidWireMessage)
        }

        let status = await runtime.status
        let secondCloseCount = await second.closeCount
        XCTAssertEqual(status.transport, .connected)
        XCTAssertEqual(secondCloseCount, 0)
    }

    func testSuspendedTerminalCloseCannotOverwriteNewConnectedChannel() async throws {
        let fixture = try makeSignedCommandFixture()
        let terminal = MacAccessRelayError(
            schemaVersion: "evaos.mac_access.relay_error.v1",
            messageType: "error", code: "relay_closed", terminal: true
        )
        let first = ControlledRelaySocket(
            received: [
                try MacAccessWire.canonicalData(registrationAck()),
                try MacAccessWire.canonicalData(terminal),
            ],
            suspendClose: true
        )
        let second = ControlledRelaySocket(received: [try MacAccessWire.canonicalData(registrationAck())])
        let runtime = MacAccessHelperRuntime(
            vault: MemoryCredentialVault(credentialRecord(for: fixture)),
            redeemer: UnusedRedeemer(), socketFactory: SequencedSocketFactory([first, second]),
            pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )

        _ = try await runtime.connect()
        let oldCompletion = Task { try await runtime.processOneCommand() }
        await first.waitUntilClosing()
        do {
            _ = try await runtime.connect()
            XCTFail("expected reconnect to wait for terminal safety closure")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .credentialUnavailable)
        }
        await first.releaseClose()
        for _ in 0..<20 { await Task.yield() }
        _ = try await runtime.connect()
        _ = try? await oldCompletion.value

        let status = await runtime.status
        let secondCloseCount = await second.closeCount
        XCTAssertEqual(status.transport, .connected)
        XCTAssertEqual(secondCloseCount, 0)
    }

    func testAcceptedRevokesStayLatchedWhenCredentialEraseFails() async throws {
        let fixture = try makeSignedCommandFixture()

        let localFactory = SequencedSocketFactory([])
        let localRuntime = MacAccessHelperRuntime(
            vault: MemoryCredentialVault(credentialRecord(for: fixture), failErase: true),
            redeemer: UnusedRedeemer(), socketFactory: localFactory,
            pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )
        do {
            _ = try await localRuntime.revokeLocally()
            XCTFail("expected local erase failure")
        } catch {}
        await assertRevocationLatch(localRuntime, factory: localFactory)

        let remoteRevoke = MacAccessRelayRevoke(
            schemaVersion: "evaos.mac_access.relay_revoke.v1", messageType: "revoke",
            sessionID: "session-01", channelGenerationID: "channel-generation-01",
            binding: fixture.binding, reasonCode: "grant_revoked", sequence: 43
        )
        let remoteSocket = ControlledRelaySocket(received: [
            try MacAccessWire.canonicalData(registrationAck()),
            try MacAccessWire.canonicalData(remoteRevoke),
        ])
        let remoteFactory = SequencedSocketFactory([remoteSocket])
        let remoteSink = RecordingTransportSafetySink()
        let remoteRuntime = MacAccessHelperRuntime(
            vault: MemoryCredentialVault(credentialRecord(for: fixture), failErase: true),
            redeemer: UnusedRedeemer(), socketFactory: remoteFactory,
            safetySink: remoteSink,
            pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )
        _ = try await remoteRuntime.connect()
        _ = try? await remoteRuntime.processOneCommand()
        await assertRevocationLatch(remoteRuntime, factory: remoteFactory, priorOpenCount: 1)
        let remoteEvents = await remoteSink.events
        XCTAssertEqual(remoteEvents, [.grantRevoked])

        let terminal = MacAccessRelayError(
            schemaVersion: "evaos.mac_access.relay_error.v1", messageType: "error",
            code: "grant_revoked", terminal: true
        )
        let terminalSocket = ControlledRelaySocket(received: [
            try MacAccessWire.canonicalData(registrationAck()),
            try MacAccessWire.canonicalData(terminal),
        ])
        let terminalFactory = SequencedSocketFactory([terminalSocket])
        let terminalSink = RecordingTransportSafetySink()
        let terminalRuntime = MacAccessHelperRuntime(
            vault: MemoryCredentialVault(credentialRecord(for: fixture), failErase: true),
            redeemer: UnusedRedeemer(), socketFactory: terminalFactory,
            safetySink: terminalSink,
            pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )
        _ = try await terminalRuntime.connect()
        _ = try? await terminalRuntime.processOneCommand()
        await assertRevocationLatch(terminalRuntime, factory: terminalFactory, priorOpenCount: 1)
        let terminalEvents = await terminalSink.events
        XCTAssertEqual(terminalEvents, [.grantRevoked])
    }

    func testValidPairingClearsRevocationLatchAfterCredentialEraseFailure() async throws {
        let identity = pairedIdentityRecord(bindingID: "binding-before-revocation")
        let fixture = try makeSignedCommandFixture(binding: try XCTUnwrap(identity.binding))
        let vault = MemoryCredentialVault(identity, failErase: true)
        let socket = ControlledRelaySocket(received: [try MacAccessWire.canonicalData(registrationAck())])
        let factory = SequencedSocketFactory([socket])
        let runtime = MacAccessHelperRuntime(
            vault: vault,
            redeemer: FixturePairingRedeemer(bindingID: "binding-after-revocation"),
            socketFactory: factory,
            pinnedKeys: fixture.keys,
            relayURL: try relayURL(),
            now: { fixture.now }
        )

        do {
            _ = try await runtime.revokeLocally()
            XCTFail("expected local erase failure")
        } catch {}
        await assertRevocationLatch(runtime, factory: factory)

        let repaired = try await runtime.pair(code: "ABCDEFGH2345")
        XCTAssertEqual(repaired.pairing, .paired)
        XCTAssertEqual(repaired.transport, .disconnected)
        let connected = try await runtime.connect()
        XCTAssertEqual(connected.pairing, .paired)
        XCTAssertEqual(connected.transport, .connected)
        let saveCount = await vault.saveCount
        let openCount = await factory.openCount
        XCTAssertEqual(saveCount, 1)
        XCTAssertEqual(openCount, 1)
    }

    func testDisconnectRestoresPairingStateAfterSuspendedRepair() async throws {
        let identity = pairedIdentityRecord(bindingID: "binding-before-suspended-pair")
        let fixture = try makeSignedCommandFixture(binding: try XCTUnwrap(identity.binding))
        let initial = ControlledRelaySocket(received: [try MacAccessWire.canonicalData(registrationAck())])
        let followup = ControlledRelaySocket(received: [try MacAccessWire.canonicalData(registrationAck())])
        let factory = SequencedSocketFactory([initial, followup])
        let redeemer = SuspendedThenSuccessfulRedeemer()
        let runtime = MacAccessHelperRuntime(
            vault: MemoryCredentialVault(identity), redeemer: redeemer, socketFactory: factory,
            pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )
        _ = try await runtime.connect()
        _ = await runtime.disconnect()

        let suspendedPair = Task { try await runtime.pair(code: "ABCDEFGH2345") }
        await redeemer.waitUntilSuspended()
        _ = await runtime.disconnect()
        await redeemer.releaseFirst()
        do {
            _ = try await suspendedPair.value
            XCTFail("expected invalidated pairing")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .stopped)
        }
        let restoredStatus = await runtime.status
        XCTAssertEqual(restoredStatus.pairing, .paired)

        _ = try await runtime.pair(code: "ABCDEFGH2345")
        let connected = try await runtime.connect()
        XCTAssertEqual(connected.pairing, .paired)
        XCTAssertEqual(connected.transport, .connected)
    }

    func testOneRegistrationProcessesTwoCommandsSequentiallyAndStopEndsLoop() async throws {
        let firstFixture = try makeSignedCommandFixture()
        let secondFixture = try makeNextSignedCommandFixture(after: firstFixture)
        let socket = ControlledRelaySocket(received: [
            try MacAccessWire.canonicalData(registrationAck()),
            firstFixture.wire,
            secondFixture.wire,
        ])
        let executor = CountingExecutor()
        let runtime = MacAccessHelperRuntime(
            vault: MemoryCredentialVault(credentialRecord(for: firstFixture)),
            redeemer: UnusedRedeemer(), socketFactory: SequencedSocketFactory([socket]),
            executor: executor, pinnedKeys: firstFixture.keys,
            relayURL: try relayURL(), now: { firstFixture.now }
        )
        _ = try await runtime.connect()
        let receiveLoop = Task { await runtime.processCommands() }
        await socket.waitUntilSentCount(3)

        let sentBeforeStop = await socket.sent
        let executionCountBeforeStop = await executor.executionCount
        XCTAssertEqual(executionCountBeforeStop, 2)
        XCTAssertEqual(sentBeforeStop.count, 3)
        XCTAssertEqual(
            try MacAccessWire.decodeStrict(MacAccessRelayReceipt.self, from: sentBeforeStop[1]).commandID,
            "command-01"
        )
        XCTAssertEqual(
            try MacAccessWire.decodeStrict(MacAccessRelayReceipt.self, from: sentBeforeStop[2]).commandID,
            "command-02"
        )

        _ = try await runtime.stop()
        await socket.deliver(firstFixture.wire)
        await receiveLoop.value
        let finalExecutionCount = await executor.executionCount
        let finalStatus = await runtime.status
        XCTAssertEqual(finalExecutionCount, 2)
        XCTAssertEqual(finalStatus.transport, .stopped)
    }

    func testNestedDuplicateRequestKeyRejectsBeforeExecutionOrErase() async throws {
        let fixture = try makeSignedCommandFixture()
        let wireText = try XCTUnwrap(String(data: fixture.wire, encoding: .utf8))
        let duplicate = Data(
            wireText.replacingOccurrences(of: #""x":120"#, with: #""x":120,"\u0078":120"#).utf8
        )
        let socket = QueuedRelaySocket(received: [
            try MacAccessWire.canonicalData(registrationAck()), duplicate,
        ])
        let vault = MemoryCredentialVault(credentialRecord(for: fixture))
        let executor = CountingExecutor()
        let runtime = MacAccessHelperRuntime(
            vault: vault, redeemer: UnusedRedeemer(), socketFactory: FixtureSocketFactory(socket: socket),
            executor: executor, pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )

        _ = try await runtime.connect()
        do {
            _ = try await runtime.processOneCommand()
            XCTFail("expected duplicate request key rejection")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .invalidWireMessage)
        }
        let executionCount = await executor.executionCount
        let eraseCount = await vault.eraseCount
        let record = await vault.load()
        XCTAssertEqual(executionCount, 0)
        XCTAssertEqual(eraseCount, 0)
        XCTAssertNotNil(record)
    }

    func testRevokeWithExtraNestedBindingFieldRejectsWithoutErasing() async throws {
        let fixture = try makeSignedCommandFixture()
        let ack = MacAccessRelayRegistrationAck(
            schemaVersion: "evaos.mac_access.relay_registration_ack.v1", messageType: "registration_ack",
            sessionID: "session-01", channelGenerationID: "channel-generation-01"
        )
        let revoke = MacAccessRelayRevoke(
            schemaVersion: "evaos.mac_access.relay_revoke.v1", messageType: "revoke",
            sessionID: "session-01", channelGenerationID: "channel-generation-01",
            binding: fixture.binding, reasonCode: "grant_revoked", sequence: 43
        )
        var object = try XCTUnwrap(JSONSerialization.jsonObject(
            with: MacAccessWire.canonicalData(revoke)
        ) as? [String: Any])
        var binding = try XCTUnwrap(object["binding"] as? [String: Any])
        binding["unexpected"] = true
        object["binding"] = binding
        let invalidRevoke = try JSONSerialization.data(withJSONObject: object)
        let socket = QueuedRelaySocket(received: [try MacAccessWire.canonicalData(ack), invalidRevoke])
        let vault = MemoryCredentialVault(credentialRecord(for: fixture))
        let runtime = MacAccessHelperRuntime(
            vault: vault, redeemer: UnusedRedeemer(), socketFactory: FixtureSocketFactory(socket: socket),
            pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )

        _ = try await runtime.connect()
        do {
            _ = try await runtime.processOneCommand()
            XCTFail("expected exact-shape rejection")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .invalidWireMessage)
        }

        let record = await vault.load()
        let eraseCount = await vault.eraseCount
        XCTAssertNotNil(record)
        XCTAssertEqual(eraseCount, 0)
    }

    func testRuntimePairProofVerifiesAndMatchingBindingPersists() async throws {
        let fixture = try makeSignedCommandFixture()
        let vault = MemoryCredentialVault(nil)
        let redeemer = FixturePairingRedeemer()
        let runtime = MacAccessHelperRuntime(
            vault: vault, redeemer: redeemer,
            socketFactory: FixtureSocketFactory(socket: QueuedRelaySocket(received: [])),
            pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )

        let status = try await runtime.pair(code: "ABCDEFGH2345")
        let capturedRequest = await redeemer.lastRequest
        let request = try XCTUnwrap(capturedRequest)
        let publicKey = try Curve25519.Signing.PublicKey(
            rawRepresentation: MacAccessWire.decodeBase64URL(request.proof.installationPublicKey)
        )
        XCTAssertTrue(publicKey.isValidSignature(
            try MacAccessWire.decodeBase64URL(request.proof.installationSignature),
            for: request.proof.signedPayload
        ))
        let loadedRecord = await vault.load()
        let record = try XCTUnwrap(loadedRecord)
        XCTAssertEqual(status.pairing, .paired)
        XCTAssertEqual(record.binding?.bindingID, "binding-paired")
        XCTAssertEqual(record.relayCredential, "opaque-paired-credential")
    }

    func testRuntimePairRejectsMismatchedIdentityWithoutSavingRelayCredential() async throws {
        let fixture = try makeSignedCommandFixture()
        let vault = MemoryCredentialVault(nil)
        let runtime = MacAccessHelperRuntime(
            vault: vault, redeemer: FixturePairingRedeemer(mismatchIdentity: true),
            socketFactory: FixtureSocketFactory(socket: QueuedRelaySocket(received: [])),
            pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )

        do {
            _ = try await runtime.pair(code: "ABCDEFGH2345")
            XCTFail("expected identity mismatch")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .wrongBinding)
        }

        let loadedRecord = await vault.load()
        let record = try XCTUnwrap(loadedRecord)
        let saveCount = await vault.saveCount
        XCTAssertNil(record.binding)
        XCTAssertNil(record.relayCredential)
        XCTAssertEqual(saveCount, 1)
    }

    func testFailedRepairKeepsPriorPairingAndCredential() async throws {
        let fixture = try makeSignedCommandFixture()
        let prior = pairedIdentityRecord(bindingID: "binding-prior")
        let vault = MemoryCredentialVault(prior)
        let socket = QueuedRelaySocket(received: [try MacAccessWire.canonicalData(registrationAck())])
        let runtime = MacAccessHelperRuntime(
            vault: vault, redeemer: UnusedRedeemer(), socketFactory: FixtureSocketFactory(socket: socket),
            pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )
        _ = try await runtime.connect()
        _ = await runtime.disconnect()

        do {
            _ = try await runtime.pair(code: "ABCDEFGH2345")
            XCTFail("expected rejected re-pair")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .pairingRejected)
        }

        let status = await runtime.status
        let loadedRecord = await vault.load()
        let record = try XCTUnwrap(loadedRecord)
        XCTAssertEqual(status.pairing, .paired)
        XCTAssertEqual(record.binding, prior.binding)
        XCTAssertEqual(record.relayCredential, "opaque-relay-credential-a")
    }

    func testSuccessfulRepairIsBarrierAgainstOldBindingReceiver() async throws {
        let identity = pairedIdentityRecord(bindingID: "binding-a")
        let fixture = try makeSignedCommandFixture(binding: try XCTUnwrap(identity.binding))
        let socket = ControlledRelaySocket(received: [try MacAccessWire.canonicalData(registrationAck())])
        let vault = MemoryCredentialVault(identity)
        let executor = CountingExecutor()
        let runtime = MacAccessHelperRuntime(
            vault: vault, redeemer: FixturePairingRedeemer(bindingID: "binding-b"),
            socketFactory: SequencedSocketFactory([socket]), executor: executor,
            pinnedKeys: fixture.keys, relayURL: try relayURL(), now: { fixture.now }
        )

        _ = try await runtime.connect()
        let oldReceiver = Task { try await runtime.processOneCommand() }
        await socket.waitUntilReceiving()
        let repaired = try await runtime.pair(code: "ABCDEFGH2345")
        await socket.deliver(fixture.wire)
        do {
            _ = try await oldReceiver.value
            XCTFail("expected old-binding receiver rejection")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .stopped)
        }

        let loadedRecord = await vault.load()
        let record = try XCTUnwrap(loadedRecord)
        let executionCount = await executor.executionCount
        let sent = await socket.sent
        XCTAssertEqual(repaired.pairing, .paired)
        XCTAssertEqual(repaired.transport, .disconnected)
        XCTAssertEqual(record.binding?.bindingID, "binding-b")
        XCTAssertEqual(executionCount, 0)
        XCTAssertEqual(sent.count, 1)
    }

    func testRemoteRevokeAndLocalRevokeEraseCredential() async throws {
        let fixture = try makeSignedCommandFixture()
        let ack = MacAccessRelayRegistrationAck(
            schemaVersion: "evaos.mac_access.relay_registration_ack.v1", messageType: "registration_ack",
            sessionID: "session-01", channelGenerationID: "channel-generation-01"
        )
        let revoke = MacAccessRelayRevoke(
            schemaVersion: "evaos.mac_access.relay_revoke.v1", messageType: "revoke",
            sessionID: "session-01", channelGenerationID: "channel-generation-01",
            binding: fixture.binding, reasonCode: "grant_revoked", sequence: 43
        )
        let socket = QueuedRelaySocket(received: [try MacAccessWire.canonicalData(ack), try MacAccessWire.canonicalData(revoke)])
        let vault = MemoryCredentialVault(credentialRecord(for: fixture))
        let runtime = MacAccessHelperRuntime(
            vault: vault, redeemer: UnusedRedeemer(), socketFactory: FixtureSocketFactory(socket: socket),
            pinnedKeys: fixture.keys,
            relayURL: try XCTUnwrap(URL(string: "wss://relay.example.test/mac-access-relay/v1")),
            now: { fixture.now }
        )
        _ = try await runtime.connect()
        do {
            _ = try await runtime.processOneCommand()
            XCTFail("expected remote revoke")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .revoked)
        }
        let remoteRecord = await vault.load()
        let remoteClosed = await socket.isClosed
        XCTAssertNil(remoteRecord)
        XCTAssertTrue(remoteClosed)

        let localVault = MemoryCredentialVault(credentialRecord(for: fixture))
        let localRuntime = MacAccessHelperRuntime(
            vault: localVault, redeemer: UnusedRedeemer(), socketFactory: FixtureSocketFactory(socket: QueuedRelaySocket(received: [])),
            pinnedKeys: fixture.keys,
            relayURL: try XCTUnwrap(URL(string: "wss://relay.example.test/mac-access-relay/v1")),
            now: { fixture.now }
        )
        let locallyRevoked = try await localRuntime.revokeLocally()
        let localRecord = await localVault.load()
        XCTAssertEqual(locallyRevoked.pairing, .revoked)
        XCTAssertNil(localRecord)
    }

    func testGrantRevokeAndExpiryPreemptSafetySinkAndEraseCredentials() async throws {
        let fixture = try makeSignedCommandFixture()
        let revoke = MacAccessRelayRevoke(
            schemaVersion: "evaos.mac_access.relay_revoke.v1", messageType: "revoke",
            sessionID: "session-01", channelGenerationID: "channel-generation-01",
            binding: fixture.binding, reasonCode: "grant_revoked", sequence: 43
        )
        let revokeSocket = QueuedRelaySocket(received: [
            try MacAccessWire.canonicalData(registrationAck()),
            try MacAccessWire.canonicalData(revoke),
        ])
        let revokeVault = MemoryCredentialVault(credentialRecord(for: fixture))
        let revokeSink = RecordingTransportSafetySink()
        let revokeRuntime = MacAccessHelperRuntime(
            vault: revokeVault, redeemer: UnusedRedeemer(),
            socketFactory: FixtureSocketFactory(socket: revokeSocket),
            safetySink: revokeSink, pinnedKeys: fixture.keys,
            relayURL: try relayURL(), now: { fixture.now }
        )
        _ = try await revokeRuntime.connect()
        do {
            _ = try await revokeRuntime.processOneCommand()
            XCTFail("expected remote revoke")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .revoked)
        }
        await revokeVault.waitUntilErased()
        let revokeEvents = await revokeSink.events
        let recordAfterRevoke = await revokeVault.load()
        XCTAssertEqual(revokeEvents, [.grantRevoked])
        XCTAssertNil(recordAfterRevoke)

        let clock = TransportTestClock(fixture.now)
        let expirySocket = ControlledRelaySocket(
            received: [try MacAccessWire.canonicalData(registrationAck())]
        )
        let expiryVault = MemoryCredentialVault(credentialRecord(for: fixture))
        let expirySink = RecordingTransportSafetySink()
        let expiryExecutor = CountingExecutor()
        let expiryRuntime = MacAccessHelperRuntime(
            vault: expiryVault, redeemer: UnusedRedeemer(),
            socketFactory: SequencedSocketFactory([expirySocket]),
            executor: expiryExecutor, safetySink: expirySink, pinnedKeys: fixture.keys,
            relayURL: try relayURL(), now: clock.now
        )
        _ = try await expiryRuntime.connect()
        let waitingCommand = Task { try await expiryRuntime.processOneCommand() }
        await expirySocket.waitUntilReceiving()
        clock.advance(3_600)
        await expirySocket.deliver(fixture.wire)
        do {
            _ = try await waitingCommand.value
            XCTFail("expected grant expiry")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .revoked)
        }
        let expiryEvents = await expirySink.events
        await expiryVault.waitUntilErased()
        let recordAfterExpiry = await expiryVault.load()
        let expirySocketCloseCount = await expirySocket.closeCount
        let expiredExecutionCount = await expiryExecutor.executionCount
        XCTAssertEqual(expiryEvents, [.grantExpired])
        XCTAssertNil(recordAfterExpiry)
        XCTAssertEqual(expirySocketCloseCount, 1)
        XCTAssertEqual(expiredExecutionCount, 0)

        let expiredConnectVault = MemoryCredentialVault(credentialRecord(for: fixture))
        let expiredConnectSink = RecordingTransportSafetySink()
        let expiredConnectFactory = SequencedSocketFactory([])
        let expiredConnectRuntime = MacAccessHelperRuntime(
            vault: expiredConnectVault, redeemer: UnusedRedeemer(),
            socketFactory: expiredConnectFactory, safetySink: expiredConnectSink,
            pinnedKeys: fixture.keys, relayURL: try relayURL(), now: clock.now
        )
        do {
            _ = try await expiredConnectRuntime.connect()
            XCTFail("expected stored grant expiry")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .revoked)
        }
        let expiredConnectEvents = await expiredConnectSink.events
        let expiredConnectRecord = await expiredConnectVault.load()
        let expiredConnectOpenCount = await expiredConnectFactory.openCount
        XCTAssertEqual(expiredConnectEvents, [.grantExpired])
        XCTAssertNil(expiredConnectRecord)
        XCTAssertEqual(expiredConnectOpenCount, 0)
    }

    func testBrokerRevokePreemptsCommandWhileExecutorIsSuspended() async throws {
        let fixture = try makeSignedCommandFixture()
        let socket = ControlledRelaySocket(received: [
            try MacAccessWire.canonicalData(registrationAck()),
        ])
        let vault = MemoryCredentialVault(credentialRecord(for: fixture))
        let executor = SuspendedExecutor()
        let safetySink = RecordingTransportSafetySink()
        let runtime = MacAccessHelperRuntime(
            vault: vault,
            redeemer: UnusedRedeemer(),
            socketFactory: SequencedSocketFactory([socket]),
            executor: executor,
            safetySink: safetySink,
            pinnedKeys: fixture.keys,
            relayURL: try relayURL(),
            now: { fixture.now }
        )
        _ = try await runtime.connect()
        let commandTask = Task { try await runtime.processOneCommand() }
        await socket.deliver(fixture.wire)
        await executor.waitUntilExecuting()

        let revoke = MacAccessRelayRevoke(
            schemaVersion: "evaos.mac_access.relay_revoke.v1",
            messageType: "revoke",
            sessionID: "session-01",
            channelGenerationID: "channel-generation-01",
            binding: fixture.binding,
            reasonCode: "grant_revoked",
            sequence: 43
        )
        await socket.deliver(try MacAccessWire.canonicalData(revoke))
        await safetySink.waitUntilEventCount(1)
        await vault.waitUntilErased()

        let safetyEvents = await safetySink.events
        let erasedRecord = await vault.load()
        XCTAssertEqual(safetyEvents, [.grantRevoked])
        XCTAssertNil(erasedRecord)

        await executor.release()
        do {
            _ = try await commandTask.value
            XCTFail("expected in-flight command to lose authority")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .revoked)
        }
        let sent = await socket.sent
        XCTAssertEqual(sent.count, 1)
    }

    func testTerminalChannelLossPreemptsInFlightCommandWithoutErasingPairing() async throws {
        let fixture = try makeSignedCommandFixture()
        let socket = ControlledRelaySocket(received: [
            try MacAccessWire.canonicalData(registrationAck()),
        ])
        let vault = MemoryCredentialVault(credentialRecord(for: fixture))
        let executor = SuspendedExecutor()
        let safetySink = RecordingTransportSafetySink()
        let runtime = MacAccessHelperRuntime(
            vault: vault,
            redeemer: UnusedRedeemer(),
            socketFactory: SequencedSocketFactory([socket]),
            executor: executor,
            safetySink: safetySink,
            pinnedKeys: fixture.keys,
            relayURL: try relayURL(),
            now: { fixture.now }
        )
        _ = try await runtime.connect()
        let commandTask = Task { try await runtime.processOneCommand() }
        await socket.deliver(fixture.wire)
        await executor.waitUntilExecuting()

        let terminal = MacAccessRelayError(
            schemaVersion: "evaos.mac_access.relay_error.v1",
            messageType: "error",
            code: "relay_unavailable",
            terminal: true
        )
        await socket.deliver(try MacAccessWire.canonicalData(terminal))
        await safetySink.waitUntilEventCount(1)

        let safetyEvents = await safetySink.events
        let preservedRecord = await vault.load()
        let blockedStatus = await runtime.status
        XCTAssertEqual(safetyEvents, [.channelClosed])
        XCTAssertNotNil(preservedRecord)
        XCTAssertEqual(blockedStatus.transport, .blocked)

        await executor.release()
        do {
            _ = try await commandTask.value
            XCTFail("expected in-flight command to lose channel authority")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .stopped)
        }
        let sent = await socket.sent
        XCTAssertEqual(sent.count, 1)
    }

    func testChannelDetachesBeforeSuspendedSafetySinkAndBlocksReconnect() async throws {
        let fixture = try makeSignedCommandFixture()
        let first = ControlledRelaySocket(received: [
            try MacAccessWire.canonicalData(registrationAck()),
        ])
        let second = ControlledRelaySocket(received: [
            try MacAccessWire.canonicalData(registrationAck()),
        ])
        let vault = MemoryCredentialVault(credentialRecord(for: fixture))
        let executor = SuspendedExecutor()
        let safetySink = SuspendedTransportSafetySink()
        let runtime = MacAccessHelperRuntime(
            vault: vault,
            redeemer: UnusedRedeemer(),
            socketFactory: SequencedSocketFactory([first, second]),
            executor: executor,
            safetySink: safetySink,
            pinnedKeys: fixture.keys,
            relayURL: try relayURL(),
            now: { fixture.now }
        )
        _ = try await runtime.connect()
        let commandTask = Task { try await runtime.processOneCommand() }
        await first.deliver(fixture.wire)
        await executor.waitUntilExecuting()

        let terminal = MacAccessRelayError(
            schemaVersion: "evaos.mac_access.relay_error.v1",
            messageType: "error",
            code: "relay_unavailable",
            terminal: true
        )
        await first.deliver(try MacAccessWire.canonicalData(terminal))
        await safetySink.waitUntilSuspended()

        do {
            _ = try await runtime.connect()
            XCTFail("expected reconnect to wait for safety preemption")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .credentialUnavailable)
        }

        await executor.release()
        do {
            _ = try await commandTask.value
            XCTFail("expected detached channel to reject the completed command")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .stopped)
        }
        let sentWhileSafetySuspended = await first.sent
        XCTAssertEqual(sentWhileSafetySuspended.count, 1)

        await safetySink.release()
        await first.waitUntilCloseCount(1)
        let preservedRecord = await vault.load()
        XCTAssertNotNil(preservedRecord)
    }

    func testGrantExpiryDeadlinePreemptsCommandWhileExecutorIsSuspended() async throws {
        let fixture = try makeSignedCommandFixture()
        let clock = TransportTestClock(fixture.now)
        let sleeper = ControlledExpirySleeper()
        let socket = ControlledRelaySocket(received: [
            try MacAccessWire.canonicalData(registrationAck()),
        ])
        let vault = MemoryCredentialVault(credentialRecord(for: fixture))
        let executor = SuspendedExecutor()
        let safetySink = RecordingTransportSafetySink()
        let runtime = MacAccessHelperRuntime(
            vault: vault,
            redeemer: UnusedRedeemer(),
            socketFactory: SequencedSocketFactory([socket]),
            executor: executor,
            safetySink: safetySink,
            pinnedKeys: fixture.keys,
            relayURL: try relayURL(),
            now: clock.now,
            sleepFor: { interval in try await sleeper.sleep(for: interval) }
        )
        _ = try await runtime.connect()
        await sleeper.waitUntilSleeping()
        let commandTask = Task { try await runtime.processOneCommand() }
        await socket.deliver(fixture.wire)
        await executor.waitUntilExecuting()

        clock.advance(3_600)
        await sleeper.release()
        await safetySink.waitUntilEventCount(1)
        await vault.waitUntilErased()

        let safetyEvents = await safetySink.events
        let erasedRecord = await vault.load()
        XCTAssertEqual(safetyEvents, [.grantExpired])
        XCTAssertNil(erasedRecord)

        await executor.release()
        do {
            _ = try await commandTask.value
            XCTFail("expected expired grant to preempt in-flight command")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .revoked)
        }
        let sent = await socket.sent
        XCTAssertEqual(sent.count, 1)
    }

    func testProductionExecutorFailsClosedUntilPolicySlice() async {
        let result = PolicyUnavailableMacAccessExecutor.result()
        XCTAssertEqual(result.outcome, .denied)
        XCTAssertEqual(result.errorCode, MacAccessPublicError.policyUnavailable.rawValue)
    }

    private func credentialRecord(for fixture: SignedCommandFixture) -> MacAccessCredentialRecord {
        MacAccessCredentialRecord(
            privateKeyRaw: Curve25519.Signing.PrivateKey().rawRepresentation,
            connectorInstallationID: fixture.binding.connectorInstallationID,
            connectorKeyID: fixture.binding.connectorKeyID,
            binding: fixture.binding,
            relayCredential: "opaque-relay-credential",
            relayCredentialExpiresAt: "2026-07-15T08:30:00Z",
            pairingAuditID: "pairing-audit-01"
        )
    }

    private func pairedIdentityRecord(bindingID: String) -> MacAccessCredentialRecord {
        let key = Curve25519.Signing.PrivateKey()
        let installationID = "install-paired"
        let keyID = "ed25519:\(MacAccessWire.sha256Hex(key.publicKey.rawRepresentation))"
        let binding = MacAccessSelectedBinding(
            customerID: "customer-a", customerVMID: "vm-a", deviceID: "mac-a",
            grantID: "grant-a", runtime: "openclaw", bindingID: bindingID,
            bindingVersion: "v1", grantExpiresAt: "2030-01-02T03:04:05.000Z",
            connectorInstallationID: installationID, connectorKeyID: keyID,
            bindingFingerprintSHA256: String(repeating: "a", count: 64)
        )
        return MacAccessCredentialRecord(
            privateKeyRaw: key.rawRepresentation,
            connectorInstallationID: installationID,
            connectorKeyID: keyID,
            binding: binding,
            relayCredential: "opaque-relay-credential-a",
            relayCredentialExpiresAt: "2030-01-02T03:04:05.000Z",
            pairingAuditID: "pairing-audit-a"
        )
    }

    private func registrationAck() -> MacAccessRelayRegistrationAck {
        MacAccessRelayRegistrationAck(
            schemaVersion: "evaos.mac_access.relay_registration_ack.v1",
            messageType: "registration_ack", sessionID: "session-01",
            channelGenerationID: "channel-generation-01"
        )
    }

    private func relayURL() throws -> URL {
        try XCTUnwrap(URL(string: "wss://relay.example.test/mac-access-relay/v1"))
    }

    private func assertRevocationLatch(
        _ runtime: MacAccessHelperRuntime,
        factory: SequencedSocketFactory,
        priorOpenCount: Int = 0
    ) async {
        let status = await runtime.status
        XCTAssertEqual(status.pairing, .revoked)
        XCTAssertEqual(status.lastError, .revoked)
        do {
            _ = try await runtime.connect()
            XCTFail("revocation latch allowed reconnect")
        } catch {
            XCTAssertEqual(error as? MacAccessPublicError, .revoked)
        }
        let openCount = await factory.openCount
        XCTAssertEqual(openCount, priorOpenCount)
    }

    private func assertError<T>(_ expected: MacAccessPublicError, _ operation: () throws -> T) {
        XCTAssertThrowsError(try operation()) { XCTAssertEqual($0 as? MacAccessPublicError, expected) }
    }
}
