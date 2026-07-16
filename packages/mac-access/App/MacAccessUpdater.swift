import Foundation
import MacAccessShared
import Sparkle

@MainActor
final class MacAccessUpdater: NSObject, ObservableObject, SPUUpdaterDelegate {
    private let controller: MacAccessController
    private let installedIdentity: MacAccessUpdateIdentity?
    private var standardController: SPUStandardUpdaterController?
    private var canCheckObservation: NSKeyValueObservation?
    @Published private(set) var canCheckForUpdates = false

    init(controller: MacAccessController, bundle: Bundle = .main) {
        self.controller = controller
        self.installedIdentity = Self.loadIdentity(from: bundle)
        super.init()
        if installedIdentity != nil {
            let standardController = SPUStandardUpdaterController(
                startingUpdater: true,
                updaterDelegate: self,
                userDriverDelegate: nil
            )
            self.standardController = standardController
            canCheckObservation = standardController.updater.observe(
                \.canCheckForUpdates,
                options: [.initial, .new]
            ) { [weak self] updater, change in
                let canCheckForUpdates = change.newValue ?? updater.canCheckForUpdates
                Task { @MainActor [weak self] in
                    self?.canCheckForUpdates = canCheckForUpdates
                }
            }
        }
    }

    func checkForUpdates() {
        guard let updater = standardController?.updater, updater.canCheckForUpdates else { return }
        updater.checkForUpdates()
    }

    func updater(
        _ updater: SPUUpdater,
        shouldProceedWithUpdate updateItem: SUAppcastItem,
        updateCheck: SPUUpdateCheck,
        error: AutoreleasingUnsafeMutablePointer<NSError?>
    ) -> Bool {
        guard let installedIdentity else {
            error.pointee = Self.policyError(.missingMetadata)
            return false
        }
        let metadata = updateItem.propertiesDictionary.reduce(into: [String: String]()) { result, entry in
            guard let key = entry.key as? String, let value = entry.value as? String else { return }
            result[key] = value
        }
        switch MacAccessUpdatePolicy.validate(
            metadata: metadata,
            archiveURL: updateItem.fileURL,
            updateVersion: updateItem.versionString,
            signedFeed: updateItem.signingValidationStatus == .succeeded,
            installed: installedIdentity
        ) {
        case .success:
            return true
        case .failure(let rejection):
            error.pointee = Self.policyError(rejection)
            return false
        }
    }

    func updater(
        _ updater: SPUUpdater,
        shouldPostponeRelaunchForUpdate item: SUAppcastItem,
        untilInvokingBlock installHandler: @escaping () -> Void
    ) -> Bool {
        Task { @MainActor in
            let result = await controller.prepareToQuit()
            guard result == .completed(.localStop) else { return }
            installHandler()
        }
        return true
    }

    func updater(
        _ updater: SPUUpdater,
        willInstallUpdateOnQuit item: SUAppcastItem,
        immediateInstallationBlock installHandler: @escaping () -> Void
    ) -> Bool {
        Task { @MainActor in
            let result = await controller.prepareToQuit()
            guard result == .completed(.localStop) else { return }
            installHandler()
        }
        return true
    }

    private static func loadIdentity(from bundle: Bundle) -> MacAccessUpdateIdentity? {
        func string(_ key: String) -> String? {
            guard let value = bundle.object(forInfoDictionaryKey: key) as? String,
                  !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else { return nil }
            return value
        }
        func integer(_ key: String, allowZero: Bool = false) -> Int? {
            let value: Int?
            if let number = bundle.object(forInfoDictionaryKey: key) as? NSNumber {
                value = number.intValue
            } else if let text = string(key) {
                value = Int(text)
            } else {
                value = nil
            }
            guard let value, allowZero ? value >= 0 : value > 0 else { return nil }
            return value
        }
        guard let feedURLText = string("SUFeedURL"),
              let feedURL = URL(string: feedURLText), feedURL.scheme == "https",
              string("SUPublicEDKey") != nil,
              let bundleVersion = string("CFBundleVersion"),
              let productVersion = string("CFBundleShortVersionString"),
              let sourceCommit = string("MacAccessSourceCommit"), sourceCommit.count == 40,
              let appRequirement = string("MacAccessAppRequirementSHA256"),
              let helperRequirement = string("MacAccessHelperRequirementSHA256"),
              let connectorRequirement = string("MacAccessConnectorRequirementSHA256"),
              let helperEntitlements = string("MacAccessHelperEntitlementsSHA256"),
              let helperRelation = string("MacAccessHelperRelationSHA256"),
              let securityEpoch = integer("MacAccessSecurityEpoch", allowZero: true),
              let credentialSecurityEpoch = integer("MacAccessCredentialSecurityEpoch"),
              let schemaReaderVersion = integer("MacAccessSchemaReaderVersion"),
              let schemaWriterVersion = integer("MacAccessSchemaWriterVersion"),
              let rollbackKeyID = string("MacAccessRollbackKeyID"),
              let rollbackKeyText = string("MacAccessRollbackPublicKeyBase64URL"),
              let rollbackPublicKey = Self.decodeBase64URL(rollbackKeyText),
              rollbackPublicKey.count == 32,
              let archiveHost = feedURL.host
        else { return nil }
        return MacAccessUpdateIdentity(
            appRequirementSHA256: appRequirement,
            helperRequirementSHA256: helperRequirement,
            connectorRequirementSHA256: connectorRequirement,
            helperEntitlementsSHA256: helperEntitlements,
            helperRelationSHA256: helperRelation,
            securityEpoch: securityEpoch,
            credentialSecurityEpoch: credentialSecurityEpoch,
            schemaReaderVersion: schemaReaderVersion,
            schemaWriterVersion: schemaWriterVersion,
            bundleVersion: bundleVersion,
            productVersion: productVersion,
            sourceCommit: sourceCommit,
            rollbackKeyID: rollbackKeyID,
            rollbackPublicKey: rollbackPublicKey,
            archiveHost: archiveHost,
            archivePathPrefix: "/mac-access/"
        )
    }

    private static func decodeBase64URL(_ value: String) -> Data? {
        guard !value.isEmpty, value.count % 4 != 1 else { return nil }
        let normalized = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padded = normalized + String(repeating: "=", count: (4 - normalized.count % 4) % 4)
        return Data(base64Encoded: padded)
    }

    private static func policyError(_ rejection: MacAccessUpdateRejection) -> NSError {
        NSError(
            domain: "com.evaos.mac-access.update-policy",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Mac Access update rejected: \(rejection.rawValue)"]
        )
    }
}
