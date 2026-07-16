import XCTest
@testable import MacAccessShared

final class UpdatePolicyTests: XCTestCase {
    private let hashA = String(repeating: "a", count: 64)
    private let hashB = String(repeating: "b", count: 64)

    func testAcceptsExactSignedForwardUpdate() {
        assertAccepted(validate())
    }

    func testRejectsUnsignedFeedAndWorkbenchProduct() {
        assertRejected(validate(signedFeed: false), as: .unsignedFeed)
        assertRejected(validate(changes: ["product_id": "com.evaos.workbench"]), as: .productMismatch)
    }

    func testRejectsIdentityHelperAndSchemaDriftEvenWithSameBundleID() {
        assertRejected(validate(changes: ["team_id": "WRONGTEAM1"]), as: .identityMismatch)
        assertRejected(validate(changes: ["helper_relation_sha256": hashB]), as: .helperRelationMismatch)
        assertRejected(validate(changes: ["core_manifest_schema": "unknown/v2"]), as: .schemaMismatch)
    }

    func testRejectsWrongArchiveAndNonMonotonicVersion() {
        assertRejected(
            validate(archiveURL: URL(string: "https://updates.evaos.com/workbench/update.zip")!),
            as: .archiveMismatch
        )
        assertRejected(validate(version: "1"), as: .unsafeVersion)
        assertRejected(validate(version: "0"), as: .unsafeVersion)
        assertRejected(
            validate(archiveURL: URL(string: "https://updates.evaos.com/mac-access/../workbench/update.zip")!),
            as: .archiveMismatch
        )
    }

    func testEpochRegressionRejectsOpaqueAuthorizationID() {
        assertRejected(validate(changes: ["security_epoch": "0"]), as: .rollbackAuthorizationRequired)
        assertRejected(validate(changes: [
            "security_epoch": "0",
            "rollback_authorization_schema": "evaos.mac_access.signed_rollback_authorization.v1",
            "rollback_authorization_id": "rollback-01",
        ]), as: .rollbackAuthorizationRequired)
    }

    func testAcceptsExactBrokerSignedTimeBoundRollbackGolden() throws {
        let goldenURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("mac-connector-core/contracts/v1/golden/rollback-authorization-golden.json")
        let wrapper = try Data(contentsOf: goldenURL)
        let encodedWrapper = wrapper.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        let publicKey = try XCTUnwrap(Self.decodeBase64URL(
            "cIhgSfos2h9yuLvFu46o3Y8JSYSsyCnt5h3ZPuxs2uY"
        ))
        let installed = identity(
            securityEpoch: 2,
            credentialSecurityEpoch: 2,
            schemaReaderVersion: 2,
            schemaWriterVersion: 2,
            bundleVersion: "2",
            productVersion: "0.2.0",
            sourceCommit: String(repeating: "b", count: 40),
            rollbackPublicKey: publicKey
        )
        var metadata = validMetadata(version: "3")
        metadata.merge([
            "build_version": "0.1.0-contract-fixture",
            "source_commit": String(repeating: "a", count: 40),
            "security_epoch": "1",
            "credential_security_epoch": "1",
            "schema_reader_version": "1",
            "schema_writer_version": "1",
            "rollback_authorization_schema": "evaos.mac_access.signed_rollback_authorization.v1",
            "rollback_authorization_id": "rollback-01",
            "rollback_authorization_base64url": encodedWrapper,
        ]) { _, new in new }
        assertAccepted(MacAccessUpdatePolicy.validate(
            metadata: metadata,
            archiveURL: URL(string: "https://updates.evaos.com/mac-access/v0/update.zip"),
            updateVersion: "3",
            signedFeed: true,
            installed: installed,
            now: try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-15T08:00:00Z"))
        ))

        metadata["rollback_authorization_id"] = "wrong-target"
        assertRejected(MacAccessUpdatePolicy.validate(
            metadata: metadata,
            archiveURL: URL(string: "https://updates.evaos.com/mac-access/v0/update.zip"),
            updateVersion: "3",
            signedFeed: true,
            installed: installed,
            now: try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-15T08:00:00Z"))
        ), as: .rollbackAuthorizationRequired)
    }

    private func assertAccepted(
        _ result: Result<Void, MacAccessUpdateRejection>,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        if case .failure(let rejection) = result {
            XCTFail("Expected update acceptance, got \(rejection)", file: file, line: line)
        }
    }

    private func assertRejected(
        _ result: Result<Void, MacAccessUpdateRejection>,
        as expected: MacAccessUpdateRejection,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .failure(let actual) = result else {
            XCTFail("Expected update rejection \(expected)", file: file, line: line)
            return
        }
        XCTAssertEqual(actual, expected, file: file, line: line)
    }

    private func validate(
        changes: [String: String] = [:],
        archiveURL: URL = URL(string: "https://updates.evaos.com/mac-access/v0/update.zip")!,
        version: String = "2",
        signedFeed: Bool = true
    ) -> Result<Void, MacAccessUpdateRejection> {
        let installed = identity()
        var metadata = validMetadata(version: version)
        metadata.merge(changes) { _, new in new }
        return MacAccessUpdatePolicy.validate(
            metadata: metadata,
            archiveURL: archiveURL,
            updateVersion: version,
            signedFeed: signedFeed,
            installed: installed
        )
    }

    private func identity(
        securityEpoch: Int = 1,
        credentialSecurityEpoch: Int = 1,
        schemaReaderVersion: Int = 1,
        schemaWriterVersion: Int = 1,
        bundleVersion: String = "1",
        productVersion: String = "0.1.0",
        sourceCommit: String = String(repeating: "a", count: 40),
        rollbackPublicKey: Data = Data(repeating: 7, count: 32)
    ) -> MacAccessUpdateIdentity {
        MacAccessUpdateIdentity(
            appRequirementSHA256: hashA,
            helperRequirementSHA256: hashA,
            connectorRequirementSHA256: hashA,
            helperEntitlementsSHA256: hashA,
            helperRelationSHA256: hashA,
            securityEpoch: securityEpoch,
            credentialSecurityEpoch: credentialSecurityEpoch,
            schemaReaderVersion: schemaReaderVersion,
            schemaWriterVersion: schemaWriterVersion,
            bundleVersion: bundleVersion,
            productVersion: productVersion,
            sourceCommit: sourceCommit,
            rollbackKeyID: "rollback-key-2026-01",
            rollbackPublicKey: rollbackPublicKey,
            archiveHost: "updates.evaos.com",
            archivePathPrefix: "/mac-access/"
        )
    }

    private func validMetadata(version: String) -> [String: String] {
        [
            "product_id": "com.evaos.mac-access",
            "signed_lineage_id": "mac-access-production",
            "team_id": "TC6MS3T6NN",
            "app_requirement_sha256": hashA,
            "helper_requirement_sha256": hashA,
            "connector_requirement_sha256": hashA,
            "helper_entitlements_sha256": hashA,
            "helper_relation_sha256": hashA,
            "tcc_executable_owner": "com.evaos.mac-access.helper",
            "artifact_manifest_schema": "evaos-mac-access-release-manifest/v1",
            "core_manifest_schema": "evaos-mac-connector-core-source/v1",
            "artifact_sha256": hashA,
            "core_source_sha256": hashA,
            "security_epoch": "1",
            "credential_security_epoch": "1",
            "schema_reader_version": "1",
            "schema_writer_version": "1",
            "bundle_version": version,
            "build_version": "0.2.0",
            "source_commit": String(repeating: "c", count: 40),
        ]
    }

    private static func decodeBase64URL(_ value: String) -> Data? {
        let normalized = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padded = normalized + String(repeating: "=", count: (4 - normalized.count % 4) % 4)
        return Data(base64Encoded: padded)
    }
}
