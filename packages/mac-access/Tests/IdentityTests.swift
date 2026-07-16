import CryptoKit
import XCTest
@testable import MacAccessShared

final class IdentityTests: XCTestCase {
    func testFrozenBundleAndServiceIdentities() {
        XCTAssertEqual(MacAccessIdentity.teamID, "TC6MS3T6NN")
        XCTAssertEqual(MacAccessIdentity.appBundleID, "com.evaos.mac-access")
        XCTAssertEqual(MacAccessIdentity.helperServiceID, "com.evaos.mac-access.helper")
        XCTAssertEqual(MacAccessIdentity.connectorServiceID, "com.evaos.mac-access.connector")
    }

    func testFrozenDesignatedRequirementDigestsMatchCanonicalText() {
        XCTAssertEqual(sha256(MacAccessIdentity.appDesignatedRequirement), MacAccessIdentity.appDesignatedRequirementSHA256)
        XCTAssertEqual(sha256(MacAccessIdentity.helperDesignatedRequirement), MacAccessIdentity.helperDesignatedRequirementSHA256)
        XCTAssertEqual(sha256(MacAccessIdentity.connectorDesignatedRequirement), MacAccessIdentity.connectorDesignatedRequirementSHA256)
        XCTAssertEqual(sha256(MacAccessIdentity.workbenchDesignatedRequirement), MacAccessIdentity.workbenchDesignatedRequirementSHA256)
        XCTAssertEqual(
            sha256(MacAccessIdentity.legacyWorkbenchDesignatedRequirement),
            MacAccessIdentity.legacyWorkbenchDesignatedRequirementSHA256
        )
    }

    func testWrongRequirementDoesNotMatchFrozenDigest() {
        let wrongRequirement = MacAccessIdentity.appDesignatedRequirement + " "

        XCTAssertNotEqual(sha256(wrongRequirement), MacAccessIdentity.appDesignatedRequirementSHA256)
    }

    private func sha256(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
