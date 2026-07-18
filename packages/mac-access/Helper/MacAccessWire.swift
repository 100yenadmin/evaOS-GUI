import CryptoKit
import Foundation

enum MacAccessWire {
    static let relayPath = "/mac-access-relay/v1"
    static let maximumSafeInteger: Int64 = 9_007_199_254_740_991
    static let maximumFrameBytes = 64 << 10

    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func decodeBase64URL(_ value: String) throws -> Data {
        guard !value.isEmpty, value.utf8.allSatisfy(isBase64URLByte), value.count % 4 != 1 else {
            throw MacAccessPublicError.invalidWireMessage
        }
        let standard = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padded = standard + String(repeating: "=", count: (4 - standard.count % 4) % 4)
        guard let decoded = Data(base64Encoded: padded), base64URL(decoded) == value else {
            throw MacAccessPublicError.invalidWireMessage
        }
        return decoded
    }

    static func decodeStrict<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        _ = try strictJSONObject(from: data)
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw MacAccessPublicError.invalidWireMessage
        }
    }

    static func strictJSONObject(from data: Data) throws -> [String: Any] {
        guard data.count <= maximumFrameBytes, String(data: data, encoding: .utf8) != nil else {
            throw MacAccessPublicError.invalidWireMessage
        }
        try validateUnicodeEscapes(data)
        try rejectDuplicateObjectKeys(data)
        let value: Any
        do {
            value = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw MacAccessPublicError.invalidWireMessage
        }
        try validateJSONValue(value)
        guard let object = value as? [String: Any] else {
            throw MacAccessPublicError.invalidWireMessage
        }
        return object
    }

    static func canonicalData<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        let encoded = try encoder.encode(value)
        let object = try JSONSerialization.jsonObject(with: encoded)
        try validateJSONValue(object)
        var output = ""
        try appendCanonicalJSON(object, to: &output)
        return Data(output.utf8)
    }

    static func canonicalData(for object: [String: JSONValue]) throws -> Data {
        try canonicalData(object)
    }

    static func webSocketText(from data: Data) throws -> String {
        guard data.count <= maximumFrameBytes, let text = String(data: data, encoding: .utf8) else {
            throw MacAccessPublicError.invalidWireMessage
        }
        return text
    }

    static func requireExactKeys(_ object: [String: Any], _ keys: Set<String>) throws {
        guard Set(object.keys) == keys else { throw MacAccessPublicError.invalidWireMessage }
    }

    static func requireObject(_ value: Any?) throws -> [String: Any] {
        guard let object = value as? [String: Any] else {
            throw MacAccessPublicError.invalidWireMessage
        }
        return object
    }

    static func isIdentifier(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard (1...128).contains(bytes.count), let first = bytes.first, isASCIIAlphaNumeric(first) else {
            return false
        }
        return bytes.dropFirst().allSatisfy {
            isASCIIAlphaNumeric($0) || $0 == 46 || $0 == 95 || $0 == 58 || $0 == 45
        }
    }

    static func isSHA256(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy {
            ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
        }
    }

    static func parseInstant(_ value: String, allowingMilliseconds: Bool = false) throws -> Date {
        let pattern = allowingMilliseconds
            ? #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$"#
            : #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"#
        guard value.range(of: pattern, options: .regularExpression) != nil else {
            throw MacAccessPublicError.expiredAuthority
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = value.utf8.contains(46)
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        guard let date = formatter.date(from: value) else {
            throw MacAccessPublicError.expiredAuthority
        }
        return date
    }

    static func randomBytes(count: Int) throws -> Data {
        var data = Data(count: count)
        let status = data.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, count, buffer.baseAddress!)
        }
        guard status == errSecSuccess else { throw MacAccessPublicError.credentialUnavailable }
        return data
    }

    private static func validateJSONValue(_ value: Any) throws {
        if let object = value as? [String: Any] {
            for (_, child) in object {
                try validateJSONValue(child)
            }
            return
        }
        if let array = value as? [Any] {
            for child in array { try validateJSONValue(child) }
            return
        }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return }
            guard number.doubleValue.isFinite else { throw MacAccessPublicError.invalidWireMessage }
            return
        }
        if value is String || value is NSNull { return }
        throw MacAccessPublicError.invalidWireMessage
    }

    private static func validateUnicodeEscapes(_ data: Data) throws {
        let bytes = Array(data)
        var index = 0
        var inString = false
        while index < bytes.count {
            let byte = bytes[index]
            if byte == 34 {
                var escaped = false
                var cursor = index
                while cursor > 0, bytes[cursor - 1] == 92 {
                    escaped.toggle()
                    cursor -= 1
                }
                if !escaped { inString.toggle() }
            } else if byte == 92, inString, !isEscapedBackslash(bytes, at: index),
                      index + 1 < bytes.count, bytes[index + 1] == 117
            {
                guard let codeUnit = unicodeEscape(bytes, at: index + 2) else {
                    throw MacAccessPublicError.invalidUnicode
                }
                if (0xDC00...0xDFFF).contains(codeUnit) {
                    throw MacAccessPublicError.invalidUnicode
                }
                if (0xD800...0xDBFF).contains(codeUnit) {
                    guard index + 11 < bytes.count, bytes[index + 6] == 92, bytes[index + 7] == 117,
                          let next = unicodeEscape(bytes, at: index + 8),
                          (0xDC00...0xDFFF).contains(next)
                    else { throw MacAccessPublicError.invalidUnicode }
                    index += 11
                } else {
                    index += 5
                }
            }
            index += 1
        }
        guard !inString else { throw MacAccessPublicError.invalidWireMessage }
    }

    private static func rejectDuplicateObjectKeys(_ data: Data) throws {
        var scanner = DuplicateKeyScanner(bytes: Array(data))
        try scanner.scan()
    }

    private static func unicodeEscape(_ bytes: [UInt8], at index: Int) -> UInt16? {
        guard index + 4 <= bytes.count else { return nil }
        var value: UInt16 = 0
        for byte in bytes[index..<(index + 4)] {
            value <<= 4
            switch byte {
            case 48...57: value |= UInt16(byte - 48)
            case 65...70: value |= UInt16(byte - 65 + 10)
            case 97...102: value |= UInt16(byte - 97 + 10)
            default: return nil
            }
        }
        return value
    }

    private static func isEscapedBackslash(_ bytes: [UInt8], at index: Int) -> Bool {
        var precedingBackslashes = 0
        var cursor = index
        while cursor > 0, bytes[cursor - 1] == 92 {
            precedingBackslashes += 1
            cursor -= 1
        }
        return precedingBackslashes.isMultiple(of: 2) == false
    }

    private static func isASCIIAlphaNumeric(_ byte: UInt8) -> Bool {
        (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)
    }

    private static func isBase64URLByte(_ byte: UInt8) -> Bool {
        isASCIIAlphaNumeric(byte) || byte == 45 || byte == 95
    }

    private static func appendCanonicalJSON(_ value: Any, to output: inout String) throws {
        if let object = value as? [String: Any] {
            output.append("{")
            let keys = object.keys.sorted { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }
            for (index, key) in keys.enumerated() {
                if index > 0 { output.append(",") }
                appendJSONString(key, to: &output)
                output.append(":")
                try appendCanonicalJSON(object[key]!, to: &output)
            }
            output.append("}")
            return
        }
        if let array = value as? [Any] {
            output.append("[")
            for (index, child) in array.enumerated() {
                if index > 0 { output.append(",") }
                try appendCanonicalJSON(child, to: &output)
            }
            output.append("]")
            return
        }
        if let string = value as? String {
            appendJSONString(string, to: &output)
            return
        }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                output.append(number.boolValue ? "true" : "false")
            } else {
                output.append(try canonicalNumber(number))
            }
            return
        }
        if value is NSNull {
            output.append("null")
            return
        }
        throw MacAccessPublicError.invalidWireMessage
    }

    private static func appendJSONString(_ string: String, to output: inout String) {
        output.append("\"")
        for scalar in string.unicodeScalars {
            switch scalar.value {
            case 0x08: output.append("\\b")
            case 0x09: output.append("\\t")
            case 0x0A: output.append("\\n")
            case 0x0C: output.append("\\f")
            case 0x0D: output.append("\\r")
            case 0x22: output.append("\\\"")
            case 0x5C: output.append("\\\\")
            case 0x00...0x1F:
                output.append(String(format: "\\u%04x", scalar.value))
            default:
                output.unicodeScalars.append(scalar)
            }
        }
        output.append("\"")
    }

    private static func canonicalNumber(_ number: NSNumber) throws -> String {
        let value = number.doubleValue
        guard value.isFinite else { throw MacAccessPublicError.invalidWireMessage }
        if value == 0 { return "0" }

        var shortest = String(value).lowercased()
        if shortest.hasSuffix(".0"), !shortest.contains("e") {
            shortest.removeLast(2)
        }
        guard let exponentIndex = shortest.firstIndex(of: "e") else { return shortest }

        let mantissa = String(shortest[..<exponentIndex])
        let exponentText = String(shortest[shortest.index(after: exponentIndex)...])
        guard let exponent = Int(exponentText) else { throw MacAccessPublicError.invalidWireMessage }
        let negative = mantissa.hasPrefix("-")
        let unsignedMantissa = negative ? String(mantissa.dropFirst()) : mantissa
        let digits = unsignedMantissa.replacingOccurrences(of: ".", with: "")
        let decimalPosition = exponent + 1
        let sign = negative ? "-" : ""

        if decimalPosition > 0, decimalPosition <= 21 {
            if digits.count <= decimalPosition {
                return sign + digits + String(repeating: "0", count: decimalPosition - digits.count)
            }
            let split = digits.index(digits.startIndex, offsetBy: decimalPosition)
            return sign + digits[..<split] + "." + digits[split...]
        }
        if decimalPosition <= 0, decimalPosition > -6 {
            return sign + "0." + String(repeating: "0", count: -decimalPosition) + digits
        }

        let first = digits.first!
        let remainder = digits.dropFirst()
        let normalizedMantissa = remainder.isEmpty ? String(first) : "\(first).\(remainder)"
        let normalizedExponent = exponent >= 0 ? "+\(exponent)" : "\(exponent)"
        return sign + normalizedMantissa + "e" + normalizedExponent
    }
}

private struct DuplicateKeyScanner {
    let bytes: [UInt8]
    var index = 0

    mutating func scan() throws {
        skipWhitespace()
        try scanValue()
        skipWhitespace()
        guard index == bytes.count else { throw MacAccessPublicError.invalidWireMessage }
    }

    private mutating func scanValue() throws {
        skipWhitespace()
        guard index < bytes.count else { throw MacAccessPublicError.invalidWireMessage }
        switch bytes[index] {
        case 123: try scanObject()
        case 91: try scanArray()
        case 34: _ = try scanString()
        default: try scanPrimitive()
        }
    }

    private mutating func scanObject() throws {
        index += 1
        skipWhitespace()
        if consume(125) { return }
        var keys: Set<[UInt16]> = []
        while true {
            guard index < bytes.count, bytes[index] == 34 else {
                throw MacAccessPublicError.invalidWireMessage
            }
            let key = try scanString()
            guard keys.insert(Array(key.utf16)).inserted else {
                throw MacAccessPublicError.invalidWireMessage
            }
            skipWhitespace()
            guard consume(58) else { throw MacAccessPublicError.invalidWireMessage }
            try scanValue()
            skipWhitespace()
            if consume(125) { return }
            guard consume(44) else { throw MacAccessPublicError.invalidWireMessage }
            skipWhitespace()
        }
    }

    private mutating func scanArray() throws {
        index += 1
        skipWhitespace()
        if consume(93) { return }
        while true {
            try scanValue()
            skipWhitespace()
            if consume(93) { return }
            guard consume(44) else { throw MacAccessPublicError.invalidWireMessage }
            skipWhitespace()
        }
    }

    private mutating func scanString() throws -> String {
        let start = index
        index += 1
        var escaped = false
        while index < bytes.count {
            let byte = bytes[index]
            index += 1
            if escaped {
                escaped = false
            } else if byte == 92 {
                escaped = true
            } else if byte == 34 {
                do {
                    return try JSONDecoder().decode(String.self, from: Data(bytes[start..<index]))
                } catch {
                    throw MacAccessPublicError.invalidWireMessage
                }
            }
        }
        throw MacAccessPublicError.invalidWireMessage
    }

    private mutating func scanPrimitive() throws {
        let start = index
        while index < bytes.count,
              ![9, 10, 13, 32, 44, 93, 125].contains(bytes[index])
        {
            index += 1
        }
        guard index > start else { throw MacAccessPublicError.invalidWireMessage }
    }

    private mutating func skipWhitespace() {
        while index < bytes.count, [9, 10, 13, 32].contains(bytes[index]) { index += 1 }
    }

    private mutating func consume(_ byte: UInt8) -> Bool {
        guard index < bytes.count, bytes[index] == byte else { return false }
        index += 1
        return true
    }
}

enum MacAccessPublicError: String, Error, Codable, Equatable, Sendable {
    case invalidPairingCode = "invalid_pairing_code"
    case pairingRejected = "pairing_rejected"
    case credentialUnavailable = "credential_unavailable"
    case relayUnavailable = "relay_unavailable"
    case invalidWireMessage = "invalid_wire_message"
    case invalidUnicode = "invalid_unicode"
    case unsafeInteger = "unsafe_integer"
    case wrongBinding = "wrong_binding"
    case digestMismatch = "digest_mismatch"
    case signatureMismatch = "signature_mismatch"
    case expiredAuthority = "expired_authority"
    case replayRejected = "replay_rejected"
    case policyUnavailable = "policy_unavailable"
    case revoked = "revoked"
    case stopped = "stopped"
}

enum JSONValue: Codable, Equatable, Sendable {
    case string(String)
    case integer(Int64)
    case number(Double)
    case boolean(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .boolean(value) }
        else if let value = try? container.decode(Double.self), value.isFinite {
            if value.rounded(.towardZero) == value,
               value >= Double(Int64.min), value < Double(Int64.max),
               abs(value) <= Double(MacAccessWire.maximumSafeInteger)
            {
                self = .integer(Int64(value))
            } else {
                self = .number(value)
            }
        } else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { throw MacAccessPublicError.invalidWireMessage }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .integer(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .boolean(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

struct MacAccessSelectedBinding: Codable, Equatable, Sendable {
    let customerID: String
    let customerVMID: String
    let deviceID: String
    let grantID: String
    let runtime: String
    let bindingID: String
    let bindingVersion: String
    let grantExpiresAt: String
    let connectorInstallationID: String
    let connectorKeyID: String
    let bindingFingerprintSHA256: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case customerID = "customer_id"
        case customerVMID = "customer_vm_id"
        case deviceID = "device_id"
        case grantID = "grant_id"
        case runtime
        case bindingID = "binding_id"
        case bindingVersion = "binding_version"
        case grantExpiresAt = "grant_expires_at"
        case connectorInstallationID = "connector_installation_id"
        case connectorKeyID = "connector_key_id"
        case bindingFingerprintSHA256 = "binding_fingerprint_sha256"
    }

    func validate(now: Date) throws {
        let identifiers = [
            customerID, customerVMID, deviceID, grantID, bindingID, bindingVersion,
            connectorInstallationID, connectorKeyID,
        ]
        guard identifiers.allSatisfy(MacAccessWire.isIdentifier),
              runtime == "openclaw" || runtime == "hermes",
              MacAccessWire.isSHA256(bindingFingerprintSHA256),
              try MacAccessWire.parseInstant(grantExpiresAt, allowingMilliseconds: true) > now
        else { throw MacAccessPublicError.wrongBinding }
    }

    func canonicalizedForRelay() throws -> Self {
        let expiry = try MacAccessWire.parseInstant(
            grantExpiresAt, allowingMilliseconds: true
        )
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.formatOptions = [.withInternetDateTime]
        return Self(
            customerID: customerID,
            customerVMID: customerVMID,
            deviceID: deviceID,
            grantID: grantID,
            runtime: runtime,
            bindingID: bindingID,
            bindingVersion: bindingVersion,
            grantExpiresAt: formatter.string(from: expiry),
            connectorInstallationID: connectorInstallationID,
            connectorKeyID: connectorKeyID,
            bindingFingerprintSHA256: bindingFingerprintSHA256
        )
    }
}

struct MacAccessExecutionContextClaims: Codable, Equatable, Sendable {
    let schemaVersion: String
    let keyID: String
    let runtime: String
    let customerID: String
    let customerVMID: String
    let bindingID: String
    let bindingVersion: String
    let issuedAt: Int64
    let expiresAt: Int64
    let contextID: String

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case keyID = "key_id"
        case runtime
        case customerID = "customer_id"
        case customerVMID = "customer_vm_id"
        case bindingID = "binding_id"
        case bindingVersion = "binding_version"
        case issuedAt = "issued_at"
        case expiresAt = "expires_at"
        case contextID = "context_id"
    }
}

struct MacAccessExecutionContext: Codable, Equatable, Sendable {
    let claims: MacAccessExecutionContextClaims
    let payloadBase64URL: String
    let payloadSHA256: String
    let signatureBase64URL: String
    let keyID: String

    enum CodingKeys: String, CodingKey {
        case claims
        case payloadBase64URL = "payload_base64url"
        case payloadSHA256 = "payload_sha256"
        case signatureBase64URL = "signature_base64url"
        case keyID = "key_id"
    }
}

struct MacAccessCommandBody: Codable, Equatable, Sendable {
    let capability: String
    let request: [String: JSONValue]
    let requestDigestSHA256: String

    enum CodingKeys: String, CodingKey {
        case capability, request
        case requestDigestSHA256 = "request_digest_sha256"
    }
}

struct MacAccessCommandAuthorityPayload: Codable, Equatable, Sendable {
    let schemaVersion: String
    let domain: String
    let sessionID: String
    let channelGenerationID: String
    let commandID: String
    let issuedAt: String
    let expiresAt: String
    let sequence: Int64
    let policyEpoch: Int64
    let nonce: String
    let binding: MacAccessSelectedBinding
    let executionContextSHA256: String
    let capability: String
    let requestDigestSHA256: String

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case domain
        case sessionID = "session_id"
        case channelGenerationID = "channel_generation_id"
        case commandID = "command_id"
        case issuedAt = "issued_at"
        case expiresAt = "expires_at"
        case sequence
        case policyEpoch = "policy_epoch"
        case nonce, binding
        case executionContextSHA256 = "execution_context_sha256"
        case capability
        case requestDigestSHA256 = "request_digest_sha256"
    }
}

struct MacAccessCommandAuthorization: Codable, Equatable, Sendable {
    let schemaVersion: String
    let canonicalization: String
    let payload: MacAccessCommandAuthorityPayload
    let payloadSHA256: String
    let keyID: String
    let signatureBase64URL: String

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case canonicalization, payload
        case payloadSHA256 = "payload_sha256"
        case keyID = "key_id"
        case signatureBase64URL = "signature_base64url"
    }
}

struct MacAccessBrokerCommand: Codable, Equatable, Sendable {
    let schemaVersion: String
    let messageType: String
    let sessionID: String
    let channelGenerationID: String
    let commandID: String
    let issuedAt: String
    let expiresAt: String
    let sequence: Int64
    let policyEpoch: Int64
    let nonce: String
    let binding: MacAccessSelectedBinding
    let executionContext: MacAccessExecutionContext
    let command: MacAccessCommandBody
    let authorization: MacAccessCommandAuthorization

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case messageType = "message_type"
        case sessionID = "session_id"
        case channelGenerationID = "channel_generation_id"
        case commandID = "command_id"
        case issuedAt = "issued_at"
        case expiresAt = "expires_at"
        case sequence
        case policyEpoch = "policy_epoch"
        case nonce, binding
        case executionContext = "execution_context"
        case command, authorization
    }
}

struct MacAccessRelayRegistration: Codable, Equatable, Sendable {
    let schemaVersion = "evaos.mac_access.relay_registration.v1"
    let messageType = "registration"
    let credential: String
    let connectorInstallationID: String
    let connectorKeyID: String
    let nonce: String

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case messageType = "message_type"
        case credential
        case connectorInstallationID = "connector_installation_id"
        case connectorKeyID = "connector_key_id"
        case nonce
    }
}

struct MacAccessRelayRegistrationAck: Codable, Equatable, Sendable {
    let schemaVersion: String
    let messageType: String
    let sessionID: String
    let channelGenerationID: String

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case messageType = "message_type"
        case sessionID = "session_id"
        case channelGenerationID = "channel_generation_id"
    }
}

struct MacAccessRelayRevoke: Codable, Equatable, Sendable {
    let schemaVersion: String
    let messageType: String
    let sessionID: String
    let channelGenerationID: String
    let binding: MacAccessSelectedBinding
    let reasonCode: String
    let sequence: Int64

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case messageType = "message_type"
        case sessionID = "session_id"
        case channelGenerationID = "channel_generation_id"
        case binding
        case reasonCode = "reason_code"
        case sequence
    }
}

struct MacAccessRelayError: Codable, Equatable, Sendable {
    let schemaVersion: String
    let messageType: String
    let code: String
    let terminal: Bool

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case messageType = "message_type"
        case code, terminal
    }
}

enum MacAccessReceiptOutcome: String, Codable, Equatable, Sendable {
    case executed, denied, failed, cancelled
}

struct MacAccessRelayReceipt: Codable, Equatable, Sendable {
    let schemaVersion: String
    let messageType: String
    let sessionID: String
    let channelGenerationID: String
    let commandID: String
    let requestDigestSHA256: String
    let binding: MacAccessSelectedBinding
    let localAuditID: String
    let outcome: MacAccessReceiptOutcome
    let errorCode: String?
    let result: [String: JSONValue]?
    let sequence: Int64

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case messageType = "message_type"
        case sessionID = "session_id"
        case channelGenerationID = "channel_generation_id"
        case commandID = "command_id"
        case requestDigestSHA256 = "request_digest_sha256"
        case binding
        case localAuditID = "local_audit_id"
        case outcome
        case errorCode = "error_code"
        case result
        case sequence
    }
}
