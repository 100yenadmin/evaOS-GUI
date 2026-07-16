import CryptoKit
import Foundation

enum MacAccessPairingCode {
    private static let alphabet = Set("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

    static func normalize(_ value: String) throws -> String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard normalized.count == 12, normalized.allSatisfy(alphabet.contains) else {
            throw MacAccessPublicError.invalidPairingCode
        }
        return normalized
    }
}

struct MacAccessPairingProof: Codable, Equatable, Sendable {
    let schemaVersion: String
    let pairingCode: String
    let connectorInstallationID: String
    let connectorKeyID: String
    let installationPublicKey: String
    let localInstallationNonce: String
    let installationSignature: String

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case pairingCode = "pairing_code"
        case connectorInstallationID = "connector_installation_id"
        case connectorKeyID = "connector_key_id"
        case installationPublicKey = "installation_public_key"
        case localInstallationNonce = "local_installation_nonce"
        case installationSignature = "installation_signature"
    }

    var signedPayload: Data {
        Data(
            "{\"schema_version\":\"\(schemaVersion)\",\"purpose\":\"redeem_mac_access_pairing\",\"pairing_code\":\"\(pairingCode)\",\"connector_installation_id\":\"\(connectorInstallationID)\",\"connector_key_id\":\"\(connectorKeyID)\",\"installation_public_key\":\"\(installationPublicKey)\",\"local_installation_nonce\":\"\(localInstallationNonce)\"}"
                .utf8
        )
    }
}

struct MacAccessPairingRedemptionRequest: Codable, Equatable, Sendable {
    let action = "redeem_mac_access_pairing"
    let proof: MacAccessPairingProof

    enum CodingKeys: String, CodingKey {
        case action
        case schemaVersion = "schema_version"
        case pairingCode = "pairing_code"
        case connectorInstallationID = "connector_installation_id"
        case connectorKeyID = "connector_key_id"
        case installationPublicKey = "installation_public_key"
        case localInstallationNonce = "local_installation_nonce"
        case installationSignature = "installation_signature"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(action, forKey: .action)
        try container.encode(proof.schemaVersion, forKey: .schemaVersion)
        try container.encode(proof.pairingCode, forKey: .pairingCode)
        try container.encode(proof.connectorInstallationID, forKey: .connectorInstallationID)
        try container.encode(proof.connectorKeyID, forKey: .connectorKeyID)
        try container.encode(proof.installationPublicKey, forKey: .installationPublicKey)
        try container.encode(proof.localInstallationNonce, forKey: .localInstallationNonce)
        try container.encode(proof.installationSignature, forKey: .installationSignature)
    }

    init(proof: MacAccessPairingProof) {
        self.proof = proof
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard try container.decode(String.self, forKey: .action) == action else {
            throw MacAccessPublicError.invalidWireMessage
        }
        proof = MacAccessPairingProof(
            schemaVersion: try container.decode(String.self, forKey: .schemaVersion),
            pairingCode: try container.decode(String.self, forKey: .pairingCode),
            connectorInstallationID: try container.decode(String.self, forKey: .connectorInstallationID),
            connectorKeyID: try container.decode(String.self, forKey: .connectorKeyID),
            installationPublicKey: try container.decode(String.self, forKey: .installationPublicKey),
            localInstallationNonce: try container.decode(String.self, forKey: .localInstallationNonce),
            installationSignature: try container.decode(String.self, forKey: .installationSignature)
        )
    }
}

struct MacAccessPairingRedemptionResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let schemaVersion: String
    let selectedBinding: MacAccessSelectedBinding
    let relayCredential: String
    let relayCredentialExpiresAt: String
    let auditID: String

    enum CodingKeys: String, CodingKey {
        case ok
        case schemaVersion = "schema_version"
        case selectedBinding = "selected_binding"
        case relayCredential = "relay_credential"
        case relayCredentialExpiresAt = "relay_credential_expires_at"
        case auditID = "audit_id"
    }

    static func decodeStrict(from data: Data, now: Date) throws -> Self {
        let object = try MacAccessWire.strictJSONObject(from: data)
        try MacAccessWire.requireExactKeys(object, [
            "ok", "schema_version", "selected_binding", "relay_credential",
            "relay_credential_expires_at", "audit_id",
        ])
        let binding = try MacAccessWire.requireObject(object["selected_binding"])
        try MacAccessWire.requireExactKeys(binding, Set(MacAccessSelectedBinding.CodingKeys.allCases.map(\.stringValue)))
        let response = try MacAccessWire.decodeStrict(Self.self, from: data)
        guard response.ok,
              response.schemaVersion == "evaos.mac_access.pairing_redeem_response.v1",
              !response.relayCredential.isEmpty,
              response.relayCredential.utf8.count <= 4096,
              MacAccessWire.isIdentifier(response.auditID),
              try MacAccessWire.parseInstant(response.relayCredentialExpiresAt, allowingMilliseconds: true) > now
        else { throw MacAccessPublicError.pairingRejected }
        try response.selectedBinding.validate(now: now)
        return response
    }
}

protocol MacAccessPairingRedeemer: Sendable {
    func redeem(_ request: MacAccessPairingRedemptionRequest, now: Date) async throws
        -> MacAccessPairingRedemptionResponse
}

actor URLSessionMacAccessPairingRedeemer: MacAccessPairingRedeemer {
    private let endpoint: URL
    private let session: URLSession

    init(endpoint: URL, session: URLSession = .shared) {
        self.endpoint = endpoint
        self.session = session
    }

    func redeem(_ request: MacAccessPairingRedemptionRequest, now: Date) async throws
        -> MacAccessPairingRedemptionResponse
    {
        guard endpoint.scheme == "https" else { throw MacAccessPublicError.relayUnavailable }
        var urlRequest = URLRequest(url: endpoint)
        urlRequest.httpMethod = "POST"
        urlRequest.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        urlRequest.httpBody = try JSONEncoder().encode(request)
        do {
            let (data, response) = try await session.data(for: urlRequest)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                throw MacAccessPublicError.pairingRejected
            }
            return try MacAccessPairingRedemptionResponse.decodeStrict(from: data, now: now)
        } catch let error as MacAccessPublicError {
            throw error
        } catch {
            throw MacAccessPublicError.pairingRejected
        }
    }
}

struct MacAccessInstallationIdentity: Sendable {
    let record: MacAccessCredentialRecord
    let privateKey: Curve25519.Signing.PrivateKey

    static func loadOrCreate(in vault: any MacAccessCredentialVault) async throws -> Self {
        if let record = try await vault.load() {
            do {
                let identity = Self(
                    record: record,
                    privateKey: try Curve25519.Signing.PrivateKey(rawRepresentation: record.privateKeyRaw)
                )
                guard MacAccessWire.isIdentifier(record.connectorInstallationID),
                      record.connectorKeyID == "ed25519:\(MacAccessWire.sha256Hex(identity.privateKey.publicKey.rawRepresentation))"
                else { throw MacAccessPublicError.credentialUnavailable }
                return identity
            } catch {
                throw MacAccessPublicError.credentialUnavailable
            }
        }
        let privateKey = Curve25519.Signing.PrivateKey()
        let publicKey = privateKey.publicKey.rawRepresentation
        let keyID = "ed25519:\(MacAccessWire.sha256Hex(publicKey))"
        let installationID = "mac-access-\(UUID().uuidString.lowercased())"
        let record = MacAccessCredentialRecord(
            privateKeyRaw: privateKey.rawRepresentation,
            connectorInstallationID: installationID,
            connectorKeyID: keyID,
            binding: nil,
            relayCredential: nil,
            relayCredentialExpiresAt: nil,
            pairingAuditID: nil
        )
        try await vault.save(record)
        return Self(record: record, privateKey: privateKey)
    }

    func proof(pairingCode: String) throws -> MacAccessPairingProof {
        let code = try MacAccessPairingCode.normalize(pairingCode)
        let nonce = MacAccessWire.base64URL(try MacAccessWire.randomBytes(count: 32))
        var proof = MacAccessPairingProof(
            schemaVersion: "evaos.mac_access.pairing_redeem.v1",
            pairingCode: code,
            connectorInstallationID: record.connectorInstallationID,
            connectorKeyID: record.connectorKeyID,
            installationPublicKey: MacAccessWire.base64URL(privateKey.publicKey.rawRepresentation),
            localInstallationNonce: nonce,
            installationSignature: ""
        )
        let signature = try privateKey.signature(for: proof.signedPayload)
        proof = MacAccessPairingProof(
            schemaVersion: proof.schemaVersion,
            pairingCode: proof.pairingCode,
            connectorInstallationID: proof.connectorInstallationID,
            connectorKeyID: proof.connectorKeyID,
            installationPublicKey: proof.installationPublicKey,
            localInstallationNonce: proof.localInstallationNonce,
            installationSignature: MacAccessWire.base64URL(signature)
        )
        return proof
    }
}
