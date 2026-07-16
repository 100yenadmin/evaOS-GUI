import Foundation

public struct MacAccessUpdateIdentity: Equatable, Sendable {
    public let productID: String
    public let signedLineageID: String
    public let teamID: String
    public let appRequirementSHA256: String
    public let helperRequirementSHA256: String
    public let connectorRequirementSHA256: String
    public let helperEntitlementsSHA256: String
    public let helperRelationSHA256: String
    public let tccExecutableOwner: String
    public let artifactManifestSchema: String
    public let coreManifestSchema: String
    public let securityEpoch: Int
    public let credentialSecurityEpoch: Int
    public let schemaReaderVersion: Int
    public let schemaWriterVersion: Int
    public let bundleVersion: String
    public let productVersion: String
    public let sourceCommit: String
    public let rollbackKeyID: String
    public let rollbackPublicKey: Data
    public let archiveHost: String
    public let archivePathPrefix: String

    public init(
        productID: String = "com.evaos.mac-access",
        signedLineageID: String = "mac-access-production",
        teamID: String = "TC6MS3T6NN",
        appRequirementSHA256: String,
        helperRequirementSHA256: String,
        connectorRequirementSHA256: String,
        helperEntitlementsSHA256: String,
        helperRelationSHA256: String,
        tccExecutableOwner: String = "com.evaos.mac-access.helper",
        artifactManifestSchema: String = "evaos-mac-access-release-manifest/v1",
        coreManifestSchema: String = "evaos-mac-connector-core-source/v1",
        securityEpoch: Int,
        credentialSecurityEpoch: Int,
        schemaReaderVersion: Int,
        schemaWriterVersion: Int,
        bundleVersion: String,
        productVersion: String,
        sourceCommit: String,
        rollbackKeyID: String,
        rollbackPublicKey: Data,
        archiveHost: String,
        archivePathPrefix: String
    ) {
        self.productID = productID
        self.signedLineageID = signedLineageID
        self.teamID = teamID
        self.appRequirementSHA256 = appRequirementSHA256
        self.helperRequirementSHA256 = helperRequirementSHA256
        self.connectorRequirementSHA256 = connectorRequirementSHA256
        self.helperEntitlementsSHA256 = helperEntitlementsSHA256
        self.helperRelationSHA256 = helperRelationSHA256
        self.tccExecutableOwner = tccExecutableOwner
        self.artifactManifestSchema = artifactManifestSchema
        self.coreManifestSchema = coreManifestSchema
        self.securityEpoch = securityEpoch
        self.credentialSecurityEpoch = credentialSecurityEpoch
        self.schemaReaderVersion = schemaReaderVersion
        self.schemaWriterVersion = schemaWriterVersion
        self.bundleVersion = bundleVersion
        self.productVersion = productVersion
        self.sourceCommit = sourceCommit
        self.rollbackKeyID = rollbackKeyID
        self.rollbackPublicKey = rollbackPublicKey
        self.archiveHost = archiveHost
        self.archivePathPrefix = archivePathPrefix
    }

    var rollbackBuild: MacAccessRollbackBuild {
        MacAccessRollbackBuild(
            buildVersion: productVersion,
            sourceCommit: sourceCommit,
            signedLineageID: signedLineageID,
            securityEpoch: securityEpoch,
            credentialSecurityEpoch: credentialSecurityEpoch,
            schemaReaderVersion: schemaReaderVersion,
            schemaWriterVersion: schemaWriterVersion
        )
    }
}

public enum MacAccessUpdateRejection: String, Error, Equatable, Sendable {
    case unsignedFeed
    case missingMetadata
    case productMismatch
    case lineageMismatch
    case identityMismatch
    case helperRelationMismatch
    case schemaMismatch
    case incompatibleEpoch
    case unsafeVersion
    case archiveMismatch
    case rollbackAuthorizationRequired
}

public enum MacAccessUpdatePolicy {
    public static let metadataPrefix = "evaos:"

    public static func validate(
        metadata: [String: String],
        archiveURL: URL?,
        updateVersion: String,
        signedFeed: Bool,
        installed: MacAccessUpdateIdentity,
        now: Date = Date()
    ) -> Result<Void, MacAccessUpdateRejection> {
        guard signedFeed else { return .failure(.unsignedFeed) }
        guard let archiveURL,
              archiveURL.scheme?.lowercased() == "https",
              archiveURL.host?.lowercased() == installed.archiveHost.lowercased(),
              archiveMatches(archiveURL, installed: installed)
        else { return .failure(.archiveMismatch) }

        let requiredKeys = [
            "product_id", "signed_lineage_id", "team_id", "app_requirement_sha256",
            "helper_requirement_sha256", "connector_requirement_sha256",
            "helper_entitlements_sha256", "helper_relation_sha256", "tcc_executable_owner",
            "artifact_manifest_schema", "core_manifest_schema", "artifact_sha256",
            "core_source_sha256", "security_epoch", "credential_security_epoch",
            "schema_reader_version", "schema_writer_version", "bundle_version",
            "build_version", "source_commit",
        ]
        guard requiredKeys.allSatisfy({ value(metadata, $0) != nil })
        else { return .failure(.missingMetadata) }
        guard value(metadata, "product_id") == installed.productID
        else { return .failure(.productMismatch) }
        guard value(metadata, "signed_lineage_id") == installed.signedLineageID
        else { return .failure(.lineageMismatch) }
        guard value(metadata, "team_id") == installed.teamID,
              value(metadata, "app_requirement_sha256") == installed.appRequirementSHA256,
              value(metadata, "helper_requirement_sha256") == installed.helperRequirementSHA256,
              value(metadata, "connector_requirement_sha256") == installed.connectorRequirementSHA256,
              value(metadata, "helper_entitlements_sha256") == installed.helperEntitlementsSHA256,
              value(metadata, "tcc_executable_owner") == installed.tccExecutableOwner,
              isSHA256(value(metadata, "artifact_sha256")),
              isSHA256(value(metadata, "core_source_sha256"))
        else { return .failure(.identityMismatch) }
        guard value(metadata, "helper_relation_sha256") == installed.helperRelationSHA256
        else { return .failure(.helperRelationMismatch) }
        guard value(metadata, "artifact_manifest_schema") == installed.artifactManifestSchema,
              value(metadata, "core_manifest_schema") == installed.coreManifestSchema
        else { return .failure(.schemaMismatch) }
        guard value(metadata, "bundle_version") == updateVersion,
              compareVersions(updateVersion, installed.bundleVersion) == .orderedDescending
        else { return .failure(.unsafeVersion) }

        guard let targetSecurityEpoch = integer(metadata, "security_epoch"),
              let targetCredentialEpoch = integer(metadata, "credential_security_epoch"),
              let targetReaderVersion = integer(metadata, "schema_reader_version"),
              let targetWriterVersion = integer(metadata, "schema_writer_version"),
              let targetBuildVersion = value(metadata, "build_version"),
              let targetSourceCommit = value(metadata, "source_commit"),
              targetSecurityEpoch >= 0, targetCredentialEpoch > 0,
              targetReaderVersion > 0, targetWriterVersion > 0,
              isSHA1(targetSourceCommit)
        else { return .failure(.incompatibleEpoch) }
        if targetSecurityEpoch < installed.securityEpoch ||
            targetCredentialEpoch < installed.credentialSecurityEpoch ||
            targetReaderVersion < installed.schemaReaderVersion ||
            targetWriterVersion < installed.schemaWriterVersion
        {
            guard value(metadata, "rollback_authorization_schema") ==
                    "evaos.mac_access.signed_rollback_authorization.v1",
                  let authorizationID = value(metadata, "rollback_authorization_id"),
                  let encodedAuthorization = value(metadata, "rollback_authorization_base64url"),
                  MacAccessRollbackAuthorizationVerifier.verify(
                      encodedAuthorization: encodedAuthorization,
                      metadataAuthorizationID: authorizationID,
                      installed: installed,
                      target: MacAccessRollbackBuild(
                          buildVersion: targetBuildVersion,
                          sourceCommit: targetSourceCommit,
                          signedLineageID: installed.signedLineageID,
                          securityEpoch: targetSecurityEpoch,
                          credentialSecurityEpoch: targetCredentialEpoch,
                          schemaReaderVersion: targetReaderVersion,
                          schemaWriterVersion: targetWriterVersion
                      ),
                      now: now
                  )
            else { return .failure(.rollbackAuthorizationRequired) }
        }

        return .success(())
    }

    private static func value(_ metadata: [String: String], _ key: String) -> String? {
        let value = metadata[key] ?? metadata[metadataPrefix + key]
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    private static func integer(_ metadata: [String: String], _ key: String) -> Int? {
        guard let text = value(metadata, key), let value = Int(text) else { return nil }
        return value
    }

    private static func isSHA256(_ value: String?) -> Bool {
        guard let value, value.count == 64 else { return false }
        return value.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (97...102).contains(byte)
        }
    }

    private static func isSHA1(_ value: String) -> Bool {
        value.count == 40 && value.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (97...102).contains(byte)
        }
    }

    private static func archiveMatches(
        _ archiveURL: URL,
        installed: MacAccessUpdateIdentity
    ) -> Bool {
        guard let components = URLComponents(url: archiveURL, resolvingAgainstBaseURL: false) else {
            return false
        }
        let encodedPath = components.percentEncodedPath.lowercased()
        guard !encodedPath.contains("%2f"), !encodedPath.contains("%5c") else { return false }
        let pathComponents = archiveURL.pathComponents.filter { $0 != "/" }
        let prefixComponents = URL(fileURLWithPath: installed.archivePathPrefix)
            .pathComponents.filter { $0 != "/" }
        guard !pathComponents.contains("."), !pathComponents.contains(".."),
              pathComponents.starts(with: prefixComponents),
              pathComponents.count > prefixComponents.count
        else { return false }
        return true
    }

    private static func compareVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let left = lhs.split(separator: ".", omittingEmptySubsequences: false)
        let right = rhs.split(separator: ".", omittingEmptySubsequences: false)
        guard left.allSatisfy({ Int($0) != nil }), right.allSatisfy({ Int($0) != nil })
        else { return .orderedSame }
        for index in 0..<max(left.count, right.count) {
            let leftValue = index < left.count ? Int(left[index])! : 0
            let rightValue = index < right.count ? Int(right[index])! : 0
            if leftValue < rightValue { return .orderedAscending }
            if leftValue > rightValue { return .orderedDescending }
        }
        return .orderedSame
    }
}
