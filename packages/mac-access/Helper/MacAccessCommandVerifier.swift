import CryptoKit
import Foundation

struct MacAccessPinnedKeys: Equatable, Sendable {
    let commandKeyID: String
    let commandPublicKey: Data
    let executionContextPublicKeys: [String: Data]
}

struct MacAccessCommandVerifier: Sendable {
    static let capabilities: Set<String> = [
        "customer_mac.desktop_see",
        "customer_mac.desktop_click",
        "customer_mac.desktop_type",
        "customer_mac.desktop_set_value",
        "customer_mac.desktop_scroll",
        "customer_mac.desktop_drag",
        "customer_mac.desktop_hotkey",
        "customer_mac.desktop_focus_app",
        "customer_mac.desktop_window",
        "customer_mac.desktop_menu",
        "customer_mac.desktop_browser_action",
    ]

    let keys: MacAccessPinnedKeys

    func decodeAndVerify(
        _ data: Data,
        expectedBinding: MacAccessSelectedBinding,
        expectedSessionID: String,
        expectedChannelGenerationID: String,
        now: Date
    ) throws -> MacAccessBrokerCommand {
        let raw = try MacAccessWire.strictJSONObject(from: data)
        try validateShape(raw)
        let command = try MacAccessWire.decodeStrict(MacAccessBrokerCommand.self, from: data)
        try verify(
            command,
            expectedBinding: expectedBinding,
            expectedSessionID: expectedSessionID,
            expectedChannelGenerationID: expectedChannelGenerationID,
            now: now
        )
        return command
    }

    func verify(
        _ command: MacAccessBrokerCommand,
        expectedBinding: MacAccessSelectedBinding,
        expectedSessionID: String,
        expectedChannelGenerationID: String,
        now: Date
    ) throws {
        guard command.schemaVersion == "evaos.mac_access.broker_control.v1",
              command.messageType == "command",
              command.authorization.schemaVersion == "evaos.mac_access.command_authorization.v1",
              command.authorization.canonicalization == "RFC8785-JCS",
              command.authorization.payload.schemaVersion == "evaos.mac_access.command_authority_payload.v1",
              command.authorization.payload.domain == "evaos.mac-access/command-authority/v1"
        else { throw MacAccessPublicError.invalidWireMessage }

        guard command.sessionID == expectedSessionID,
              command.channelGenerationID == expectedChannelGenerationID,
              command.binding == expectedBinding
        else { throw MacAccessPublicError.wrongBinding }

        let identifiers = [
            command.sessionID, command.channelGenerationID, command.commandID,
            command.authorization.keyID,
        ]
        guard identifiers.allSatisfy(MacAccessWire.isIdentifier),
              command.authorization.keyID == keys.commandKeyID,
              MacAccessWire.isIdentifier(keys.commandKeyID),
              keys.commandPublicKey.count == 32,
              !keys.executionContextPublicKeys.isEmpty,
              command.authorization.keyID != command.executionContext.keyID,
              keys.executionContextPublicKeys.allSatisfy({
                  MacAccessWire.isIdentifier($0.key) && $0.value.count == 32 && $0.value != keys.commandPublicKey
              })
        else { throw MacAccessPublicError.signatureMismatch }

        let expectedPayload = MacAccessCommandAuthorityPayload(
            schemaVersion: "evaos.mac_access.command_authority_payload.v1",
            domain: "evaos.mac-access/command-authority/v1",
            sessionID: command.sessionID,
            channelGenerationID: command.channelGenerationID,
            commandID: command.commandID,
            issuedAt: command.issuedAt,
            expiresAt: command.expiresAt,
            sequence: command.sequence,
            policyEpoch: command.policyEpoch,
            nonce: command.nonce,
            binding: command.binding,
            executionContextSHA256: command.executionContext.payloadSHA256,
            capability: command.command.capability,
            requestDigestSHA256: command.command.requestDigestSHA256
        )
        guard command.authorization.payload == expectedPayload else {
            throw MacAccessPublicError.wrongBinding
        }

        let canonicalPayload = try MacAccessWire.canonicalData(command.authorization.payload)
        guard MacAccessWire.sha256Hex(canonicalPayload) == command.authorization.payloadSHA256,
              MacAccessWire.isSHA256(command.authorization.payloadSHA256)
        else { throw MacAccessPublicError.digestMismatch }
        let commandSignature = try MacAccessWire.decodeBase64URL(command.authorization.signatureBase64URL)
        let commandKey: Curve25519.Signing.PublicKey
        do {
            commandKey = try Curve25519.Signing.PublicKey(rawRepresentation: keys.commandPublicKey)
        } catch {
            throw MacAccessPublicError.signatureMismatch
        }
        guard commandKey.isValidSignature(commandSignature, for: canonicalPayload) else {
            throw MacAccessPublicError.signatureMismatch
        }

        try command.binding.validate(now: now)
        let issuedAt = try MacAccessWire.parseInstant(command.issuedAt)
        let expiresAt = try MacAccessWire.parseInstant(command.expiresAt)
        let grantExpiresAt = try MacAccessWire.parseInstant(command.binding.grantExpiresAt)
        guard issuedAt <= now.addingTimeInterval(5),
              expiresAt > now,
              expiresAt > issuedAt,
              expiresAt.timeIntervalSince(issuedAt) <= 60,
              expiresAt < grantExpiresAt,
              (1...MacAccessWire.maximumSafeInteger).contains(command.sequence),
              (0...MacAccessWire.maximumSafeInteger).contains(command.policyEpoch),
              Self.capabilities.contains(command.command.capability)
        else { throw MacAccessPublicError.expiredAuthority }

        let nonce = try MacAccessWire.decodeBase64URL(command.nonce)
        guard (12...64).contains(nonce.count) else { throw MacAccessPublicError.invalidWireMessage }

        let canonicalRequest = try MacAccessWire.canonicalData(for: command.command.request)
        guard MacAccessWire.isSHA256(command.command.requestDigestSHA256),
              MacAccessWire.sha256Hex(canonicalRequest) == command.command.requestDigestSHA256
        else { throw MacAccessPublicError.digestMismatch }

        try verifyExecutionContext(
            command.executionContext,
            binding: command.binding,
            now: now,
            commandIssuedAt: issuedAt,
            commandExpiresAt: expiresAt
        )
    }

    private func verifyExecutionContext(
        _ context: MacAccessExecutionContext,
        binding: MacAccessSelectedBinding,
        now: Date,
        commandIssuedAt: Date,
        commandExpiresAt: Date
    ) throws {
        let claims = context.claims
        guard claims.schemaVersion == "evaos.mac_control_execution_context.v1",
              claims.keyID == context.keyID,
              MacAccessWire.isIdentifier(context.keyID),
              context.keyID != keys.commandKeyID,
              let rawPublicKey = keys.executionContextPublicKeys[context.keyID],
              rawPublicKey.count == 32,
              rawPublicKey != keys.commandPublicKey
        else { throw MacAccessPublicError.signatureMismatch }

        let payload = try MacAccessWire.decodeBase64URL(context.payloadBase64URL)
        guard MacAccessWire.sha256Hex(payload) == context.payloadSHA256,
              MacAccessWire.isSHA256(context.payloadSHA256)
        else { throw MacAccessPublicError.digestMismatch }
        let signature = try MacAccessWire.decodeBase64URL(context.signatureBase64URL)
        let publicKey: Curve25519.Signing.PublicKey
        do {
            publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: rawPublicKey)
        } catch {
            throw MacAccessPublicError.signatureMismatch
        }
        guard publicKey.isValidSignature(signature, for: payload) else {
            throw MacAccessPublicError.signatureMismatch
        }

        let claimsObject = try MacAccessWire.strictJSONObject(from: payload)
        try MacAccessWire.requireExactKeys(claimsObject, [
            "schema_version", "key_id", "runtime", "customer_id", "customer_vm_id",
            "binding_id", "binding_version", "issued_at", "expires_at", "context_id",
        ])
        let decodedClaims = try MacAccessWire.decodeStrict(MacAccessExecutionContextClaims.self, from: payload)
        guard decodedClaims == claims,
              claims.runtime == binding.runtime,
              claims.customerID == binding.customerID,
              claims.customerVMID == binding.customerVMID,
              claims.bindingID == binding.bindingID,
              claims.bindingVersion == binding.bindingVersion
        else { throw MacAccessPublicError.wrongBinding }

        guard (0...MacAccessWire.maximumSafeInteger).contains(claims.issuedAt),
              (1...MacAccessWire.maximumSafeInteger).contains(claims.expiresAt),
              claims.expiresAt > claims.issuedAt,
              claims.issuedAt <= Int64(now.addingTimeInterval(5).timeIntervalSince1970),
              claims.expiresAt > Int64(now.timeIntervalSince1970),
              Int64(commandIssuedAt.timeIntervalSince1970) >= claims.issuedAt,
              claims.expiresAt >= Int64(commandExpiresAt.timeIntervalSince1970),
              let decodedContextID = try? MacAccessWire.decodeBase64URL(claims.contextID),
              decodedContextID.count == 16
        else { throw MacAccessPublicError.expiredAuthority }
    }

    private func validateShape(_ raw: [String: Any]) throws {
        try MacAccessWire.requireExactKeys(raw, [
            "schema_version", "message_type", "session_id", "channel_generation_id", "command_id",
            "issued_at", "expires_at", "sequence", "policy_epoch", "nonce", "binding",
            "execution_context", "command", "authorization",
        ])
        try validateBindingShape(try MacAccessWire.requireObject(raw["binding"]))
        let context = try MacAccessWire.requireObject(raw["execution_context"])
        try MacAccessWire.requireExactKeys(context, [
            "claims", "payload_base64url", "payload_sha256", "signature_base64url", "key_id",
        ])
        let claims = try MacAccessWire.requireObject(context["claims"])
        try MacAccessWire.requireExactKeys(claims, [
            "schema_version", "key_id", "runtime", "customer_id", "customer_vm_id",
            "binding_id", "binding_version", "issued_at", "expires_at", "context_id",
        ])
        let command = try MacAccessWire.requireObject(raw["command"])
        try MacAccessWire.requireExactKeys(command, ["capability", "request", "request_digest_sha256"])
        _ = try MacAccessWire.requireObject(command["request"])
        let authorization = try MacAccessWire.requireObject(raw["authorization"])
        try MacAccessWire.requireExactKeys(authorization, [
            "schema_version", "canonicalization", "payload", "payload_sha256", "key_id",
            "signature_base64url",
        ])
        let payload = try MacAccessWire.requireObject(authorization["payload"])
        try MacAccessWire.requireExactKeys(payload, [
            "schema_version", "domain", "session_id", "channel_generation_id", "command_id",
            "issued_at", "expires_at", "sequence", "policy_epoch", "nonce", "binding",
            "execution_context_sha256", "capability", "request_digest_sha256",
        ])
        try validateBindingShape(try MacAccessWire.requireObject(payload["binding"]))
    }

    private func validateBindingShape(_ binding: [String: Any]) throws {
        try MacAccessWire.requireExactKeys(binding, [
            "customer_id", "customer_vm_id", "device_id", "grant_id", "runtime", "binding_id",
            "binding_version", "grant_expires_at", "connector_installation_id", "connector_key_id",
            "binding_fingerprint_sha256",
        ])
    }
}

struct MacAccessReplayWindow: Sendable {
    private struct Channel: Hashable, Sendable {
        let sessionID: String
        let generationID: String
    }

    private var lastSequenceByChannel: [Channel: Int64] = [:]
    private var commandIDs: Set<String> = []
    private var nonces: Set<String> = []
    private var contextIDs: Set<String> = []

    mutating func accept(_ command: MacAccessBrokerCommand) throws {
        let channel = Channel(
            sessionID: command.sessionID,
            generationID: command.channelGenerationID
        )
        guard command.sequence > lastSequenceByChannel[channel, default: 0],
              !commandIDs.contains(command.commandID),
              !nonces.contains(command.nonce),
              !contextIDs.contains(command.executionContext.claims.contextID)
        else { throw MacAccessPublicError.replayRejected }
        lastSequenceByChannel[channel] = command.sequence
        commandIDs.insert(command.commandID)
        nonces.insert(command.nonce)
        contextIDs.insert(command.executionContext.claims.contextID)
    }

    mutating func reset() {
        self = MacAccessReplayWindow()
    }
}
