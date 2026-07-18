import Foundation
import Security

struct MacAccessCredentialRecord: Codable, Equatable, Sendable {
    let privateKeyRaw: Data
    let connectorInstallationID: String
    let connectorKeyID: String
    var binding: MacAccessSelectedBinding?
    var relayCredential: String?
    var relayCredentialExpiresAt: String?
    var pairingAuditID: String?

    var isPaired: Bool {
        binding != nil && relayCredential != nil && relayCredentialExpiresAt != nil
    }

    enum CodingKeys: String, CodingKey {
        case privateKeyRaw = "installation_private_key"
        case connectorInstallationID = "connector_installation_id"
        case connectorKeyID = "connector_key_id"
        case binding = "selected_binding"
        case relayCredential = "relay_credential"
        case relayCredentialExpiresAt = "relay_credential_expires_at"
        case pairingAuditID = "pairing_audit_id"
    }
}

protocol MacAccessCredentialVault: Sendable {
    func load() async throws -> MacAccessCredentialRecord?
    func save(_ record: MacAccessCredentialRecord) async throws
    func erase() async throws
}

struct MacAccessKeychainPolicy: Equatable, Sendable {
    let itemClass = "kSecClassGenericPassword"
    let accessGroup: String
    let service: String
    let account: String
    let accessibility = "kSecAttrAccessibleWhenUnlockedThisDeviceOnly"
    let synchronizable = false
    let usesDataProtectionKeychain = true

    static let productionEpochOne = MacAccessKeychainPolicy(
        accessGroup: "TC6MS3T6NN.com.evaos.mac-access.credentials.epoch-1",
        service: "com.evaos.mac-access.connector-credential",
        account: "installation-v1"
    )

    static let developmentEpochOne = MacAccessKeychainPolicy(
        accessGroup: "TC6MS3T6NN.com.evaos.mac-access.development.credentials.epoch-1",
        service: "com.evaos.mac-access.connector-credential",
        account: "installation-v1"
    )

    static var currentBuildEpochOne: MacAccessKeychainPolicy {
#if DEBUG
        .developmentEpochOne
#else
        .productionEpochOne
#endif
    }
}

actor SecurityMacAccessCredentialVault: MacAccessCredentialVault {
    let policy: MacAccessKeychainPolicy

    init(policy: MacAccessKeychainPolicy = .currentBuildEpochOne) {
        self.policy = policy
    }

    func load() throws -> MacAccessCredentialRecord? {
        var query = baseQuery
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw MacAccessPublicError.credentialUnavailable
        }
        do {
            return try JSONDecoder().decode(MacAccessCredentialRecord.self, from: data)
        } catch {
            throw MacAccessPublicError.credentialUnavailable
        }
    }

    func save(_ record: MacAccessCredentialRecord) throws {
        let data: Data
        do {
            data = try JSONEncoder().encode(record)
        } catch {
            throw MacAccessPublicError.credentialUnavailable
        }

        let update = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw MacAccessPublicError.credentialUnavailable
        }

        var item = baseQuery
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
            throw MacAccessPublicError.credentialUnavailable
        }
    }

    func erase() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw MacAccessPublicError.credentialUnavailable
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccessGroup as String: policy.accessGroup,
            kSecAttrService as String: policy.service,
            kSecAttrAccount as String: policy.account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
            kSecUseDataProtectionKeychain as String: kCFBooleanTrue as Any,
        ]
    }
}
