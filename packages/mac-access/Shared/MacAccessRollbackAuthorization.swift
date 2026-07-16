import CryptoKit
import Foundation

struct MacAccessRollbackBuild: Codable, Equatable, Sendable {
    let buildVersion: String
    let sourceCommit: String
    let signedLineageID: String
    let securityEpoch: Int
    let credentialSecurityEpoch: Int
    let schemaReaderVersion: Int
    let schemaWriterVersion: Int

    enum CodingKeys: String, CodingKey {
        case buildVersion = "build_version"
        case sourceCommit = "source_commit"
        case signedLineageID = "signed_lineage_id"
        case securityEpoch = "security_epoch"
        case credentialSecurityEpoch = "credential_security_epoch"
        case schemaReaderVersion = "schema_reader_version"
        case schemaWriterVersion = "schema_writer_version"
    }
}

struct MacAccessRollbackAuthorizationPayload: Codable, Equatable, Sendable {
    let schemaVersion: String
    let domain: String
    let authorizationID: String
    let source: MacAccessRollbackBuild
    let target: MacAccessRollbackBuild
    let resultingMinimumReaderSecurityEpoch: Int
    let resultingMinimumWriterSecurityEpoch: Int
    let resultingMinimumReaderSchemaVersion: Int
    let resultingMinimumWriterSchemaVersion: Int
    let issuedAt: String
    let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case domain
        case authorizationID = "authorization_id"
        case source, target
        case resultingMinimumReaderSecurityEpoch = "resulting_minimum_reader_security_epoch"
        case resultingMinimumWriterSecurityEpoch = "resulting_minimum_writer_security_epoch"
        case resultingMinimumReaderSchemaVersion = "resulting_minimum_reader_schema_version"
        case resultingMinimumWriterSchemaVersion = "resulting_minimum_writer_schema_version"
        case issuedAt = "issued_at"
        case expiresAt = "expires_at"
    }
}

struct MacAccessSignedRollbackAuthorization: Codable, Equatable, Sendable {
    let schemaVersion: String
    let canonicalization: String
    let payload: MacAccessRollbackAuthorizationPayload
    let payloadSHA256: String
    let brokerKeyID: String
    let signatureBase64URL: String

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case canonicalization, payload
        case payloadSHA256 = "payload_sha256"
        case brokerKeyID = "broker_key_id"
        case signatureBase64URL = "signature_base64url"
    }
}

enum MacAccessRollbackAuthorizationVerifier {
    static func verify(
        encodedAuthorization: String,
        metadataAuthorizationID: String,
        installed: MacAccessUpdateIdentity,
        target: MacAccessRollbackBuild,
        now: Date
    ) -> Bool {
        guard let wrapperData = decodeBase64URL(encodedAuthorization),
              let authorization = try? JSONDecoder().decode(
                  MacAccessSignedRollbackAuthorization.self,
                  from: wrapperData
              ),
              authorization.schemaVersion == "evaos.mac_access.signed_rollback_authorization.v1",
              authorization.canonicalization == "RFC8785-JCS",
              authorization.brokerKeyID == installed.rollbackKeyID,
              authorization.payload.schemaVersion == "evaos.mac_access.rollback_authorization_payload.v1",
              authorization.payload.domain == "evaos.mac-access/rollback-authorization/v1",
              authorization.payload.authorizationID == metadataAuthorizationID,
              isIdentifier(metadataAuthorizationID),
              authorization.payload.source == installed.rollbackBuild,
              authorization.payload.target == target,
              authorization.payload.source != authorization.payload.target,
              validBuild(target),
              authorization.payload.resultingMinimumReaderSecurityEpoch >= 0,
              authorization.payload.resultingMinimumWriterSecurityEpoch >= 0,
              authorization.payload.resultingMinimumReaderSchemaVersion > 0,
              authorization.payload.resultingMinimumWriterSchemaVersion > 0,
              target.securityEpoch >= authorization.payload.resultingMinimumReaderSecurityEpoch,
              target.securityEpoch >= authorization.payload.resultingMinimumWriterSecurityEpoch,
              target.schemaReaderVersion >= authorization.payload.resultingMinimumReaderSchemaVersion,
              target.schemaWriterVersion >= authorization.payload.resultingMinimumWriterSchemaVersion,
              let issuedAt = parseInstant(authorization.payload.issuedAt),
              let expiresAt = parseInstant(authorization.payload.expiresAt),
              expiresAt > issuedAt,
              issuedAt <= now.addingTimeInterval(5),
              expiresAt > now,
              let canonicalPayload = try? canonicalData(authorization.payload),
              SHA256.hash(data: canonicalPayload).hex == authorization.payloadSHA256,
              let signature = decodeBase64URL(authorization.signatureBase64URL),
              signature.count == 64,
              installed.rollbackPublicKey.count == 32,
              let publicKey = try? Curve25519.Signing.PublicKey(
                  rawRepresentation: installed.rollbackPublicKey
              ),
              publicKey.isValidSignature(signature, for: canonicalPayload)
        else { return false }
        return true
    }

    private static func canonicalData<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }

    private static func decodeBase64URL(_ value: String) -> Data? {
        guard !value.isEmpty, value.count <= 16_384, value.count % 4 != 1,
              value.utf8.allSatisfy({ byte in
                  (48...57).contains(byte) || (65...90).contains(byte) ||
                      (97...122).contains(byte) || byte == 45 || byte == 95
              })
        else { return nil }
        let normalized = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padded = normalized + String(repeating: "=", count: (4 - normalized.count % 4) % 4)
        return Data(base64Encoded: padded)
    }

    private static func isIdentifier(_ value: String) -> Bool {
        guard (1...128).contains(value.utf8.count),
              let first = value.utf8.first,
              isAlphaNumeric(first)
        else { return false }
        return value.utf8.dropFirst().allSatisfy { byte in
            isAlphaNumeric(byte) || byte == 46 || byte == 95 || byte == 58 || byte == 45
        }
    }

    private static func isAlphaNumeric(_ byte: UInt8) -> Bool {
        (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte)
    }

    private static func validBuild(_ build: MacAccessRollbackBuild) -> Bool {
        isIdentifier(build.buildVersion) &&
            isSHA1(build.sourceCommit) &&
            isIdentifier(build.signedLineageID) &&
            build.securityEpoch >= 0 &&
            build.credentialSecurityEpoch > 0 &&
            build.schemaReaderVersion > 0 &&
            build.schemaWriterVersion > 0
    }

    private static func isSHA1(_ value: String) -> Bool {
        value.count == 40 && value.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (97...102).contains(byte)
        }
    }

    private static func parseInstant(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
}

private extension SHA256.Digest {
    var hex: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
