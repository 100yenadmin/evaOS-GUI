import CryptoKit
import Foundation
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

    func testHelperBuildSettingsUseDisjointDebugAndReleaseKeychainGroups() throws {
        let packageRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let project = try String(
            contentsOf: packageRoot.appendingPathComponent("MacAccess.xcodeproj/project.pbxproj"),
            encoding: .utf8
        )
        XCTAssertTrue(project.contains("CODE_SIGN_ENTITLEMENTS = \"Resources/Entitlements/Helper-Debug.entitlements\""))
        XCTAssertTrue(project.contains("CODE_SIGN_ENTITLEMENTS = \"Resources/Entitlements/Helper-Release.entitlements\""))
        XCTAssertTrue(project.contains("SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG"))

        let debug = try String(
            contentsOf: packageRoot.appendingPathComponent("Resources/Entitlements/Helper-Debug.entitlements"),
            encoding: .utf8
        )
        let release = try String(
            contentsOf: packageRoot.appendingPathComponent("Resources/Entitlements/Helper-Release.entitlements"),
            encoding: .utf8
        )
        XCTAssertTrue(debug.contains("TC6MS3T6NN.com.evaos.mac-access.development.credentials.epoch-1"))
        XCTAssertFalse(debug.contains("<string>TC6MS3T6NN.com.evaos.mac-access.credentials.epoch-1</string>"))
        XCTAssertTrue(release.contains("TC6MS3T6NN.com.evaos.mac-access.credentials.epoch-1"))
        XCTAssertFalse(release.contains("development.credentials"))
    }

    func testLocalOnlyMenuCopyDoesNotClaimUnavailableAuthority() throws {
        let packageRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let menu = try String(
            contentsOf: packageRoot.appendingPathComponent("App/MacAccessMenu.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(menu.contains("Button(\"onboarding.title\")"))
        XCTAssertTrue(menu.contains("showOnboarding()"))
        XCTAssertFalse(menu.contains("@Environment(\\.openWindow)"))
        XCTAssertFalse(menu.contains("Button(\"action.pair\") {\n            openWindow"))
        XCTAssertTrue(menu.contains("Button(\"permission.accessibility\") {}\n                .disabled(true)"))
        XCTAssertTrue(menu.contains("Button(\"permission.screenRecording\") {}\n                .disabled(true)"))

        let onboarding = try String(
            contentsOf: packageRoot.appendingPathComponent("App/OnboardingView.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(onboarding.contains(".keyboardShortcut(.defaultAction)"))
        XCTAssertTrue(onboarding.contains(".keyboardShortcut(.cancelAction)"))
        XCTAssertTrue(onboarding.contains("window.makeKeyAndOrderFront(nil)"))

        let catalogData = try Data(contentsOf: packageRoot.appendingPathComponent("Resources/Localizable.xcstrings"))
        let catalog = try XCTUnwrap(JSONSerialization.jsonObject(with: catalogData) as? [String: Any])
        let strings = try XCTUnwrap(catalog["strings"] as? [String: Any])
        let helperValues = try localizedValues(for: "onboarding.helperInvoker", in: strings)
        XCTAssertEqual(helperValues.count, 12)
        XCTAssertEqual(Set(helperValues.values), ["Expected future permission helper identity:"])
    }

    private func sha256(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func localizedValues(for key: String, in strings: [String: Any]) throws -> [String: String] {
        let entry = try XCTUnwrap(strings[key] as? [String: Any])
        let localizations = try XCTUnwrap(entry["localizations"] as? [String: Any])
        return try localizations.mapValues { localization in
            let localization = try XCTUnwrap(localization as? [String: Any])
            let unit = try XCTUnwrap(localization["stringUnit"] as? [String: Any])
            return try XCTUnwrap(unit["value"] as? String)
        }
    }
}
