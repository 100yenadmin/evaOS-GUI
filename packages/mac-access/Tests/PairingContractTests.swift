import CryptoKit
import Foundation
import XCTest

final class PairingContractTests: XCTestCase {
    func testDashboardPairingGoldenBytesAndSignature() throws {
        let proof = MacAccessPairingProof(
            schemaVersion: "evaos.mac_access.pairing_redeem.v1",
            pairingCode: "ABCDEFGH2345",
            connectorInstallationID: "mac-access-golden-installation-v1",
            connectorKeyID: "ed25519:73c3a0fdf569d830c61e9b57385e54630e56a2fd52a5d12bb93278ac7bef0415",
            installationPublicKey: "NM3qTcHqK2BVnKyZ4xBqeZ-zHgDxVdEgIHzXdcZT2iY",
            localInstallationNonce: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            installationSignature: "WHWbjDY_Z6PBrAyYT2zO4VuSj4yzYdcbWq2dtdJUHAYZFxOZ5GSvGVNLx_JuYeMyRnhsJOPZORFR1a6kx9zGCg"
        )
        let expected = #"{"schema_version":"evaos.mac_access.pairing_redeem.v1","purpose":"redeem_mac_access_pairing","pairing_code":"ABCDEFGH2345","connector_installation_id":"mac-access-golden-installation-v1","connector_key_id":"ed25519:73c3a0fdf569d830c61e9b57385e54630e56a2fd52a5d12bb93278ac7bef0415","installation_public_key":"NM3qTcHqK2BVnKyZ4xBqeZ-zHgDxVdEgIHzXdcZT2iY","local_installation_nonce":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"}"#

        XCTAssertEqual(proof.signedPayload, Data(expected.utf8))
        let publicKey = try Curve25519.Signing.PublicKey(
            rawRepresentation: MacAccessWire.decodeBase64URL(proof.installationPublicKey)
        )
        XCTAssertTrue(publicKey.isValidSignature(
            try MacAccessWire.decodeBase64URL(proof.installationSignature),
            for: proof.signedPayload
        ))
    }

    func testExactDashboardGoldenResponseAcceptsFrozenMilliseconds() throws {
        let golden = Data(#"""
        {
          "ok":true,
          "schema_version":"evaos.mac_access.pairing_redeem_response.v1",
          "selected_binding":{
            "customer_id":"mac-access-golden-customer",
            "customer_vm_id":"10000000-0000-4000-8000-000000000001",
            "device_id":"10000000-0000-4000-8000-000000000002",
            "grant_id":"10000000-0000-4000-8000-000000000003",
            "runtime":"openclaw",
            "binding_id":"10000000-0000-4000-8000-000000000004",
            "binding_version":"1",
            "grant_expires_at":"2030-01-02T03:04:05.000Z",
            "connector_installation_id":"mac-access-golden-installation-v1",
            "connector_key_id":"ed25519:73c3a0fdf569d830c61e9b57385e54630e56a2fd52a5d12bb93278ac7bef0415",
            "binding_fingerprint_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
          },
          "relay_credential":"TEST_ONLY_RELAY_CREDENTIAL_NEVER_USE_000000",
          "relay_credential_expires_at":"2030-01-02T03:04:05.000Z",
          "audit_id":"10000000-0000-4000-8000-000000000005"
        }
        """#.utf8)
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2029-01-01T00:00:00Z"))

        let response = try MacAccessPairingRedemptionResponse.decodeStrict(from: golden, now: now)

        XCTAssertEqual(response.selectedBinding.connectorInstallationID, "mac-access-golden-installation-v1")
        XCTAssertEqual(response.relayCredentialExpiresAt, "2030-01-02T03:04:05.000Z")
    }

    func testCommandInstantStillRejectsFractionalSeconds() throws {
        XCTAssertThrowsError(try MacAccessWire.parseInstant("2030-01-02T03:04:05.000Z")) {
            XCTAssertEqual($0 as? MacAccessPublicError, .expiredAuthority)
        }
        XCTAssertNoThrow(try MacAccessWire.parseInstant(
            "2030-01-02T03:04:05.000Z", allowingMilliseconds: true
        ))
        XCTAssertNoThrow(try MacAccessWire.parseInstant(
            "2030-01-02T03:04:05.123456+00:00", allowingMilliseconds: true
        ))
        XCTAssertThrowsError(try MacAccessWire.parseInstant(
            "2030-01-02 03:04:05.123456+00:00", allowingMilliseconds: true
        ))
    }

    func testPairingCodeNormalizationIsExact() throws {
        XCTAssertEqual(try MacAccessPairingCode.normalize("  abcdefgh2345\n"), "ABCDEFGH2345")
        for invalid in ["ABCDEFGHI234", "ABCDEFGH234", "ABCDEFGH23450", "ABCD-EFG-2345", "ÅBCDEFGH2345"] {
            XCTAssertThrowsError(try MacAccessPairingCode.normalize(invalid)) {
                XCTAssertEqual($0 as? MacAccessPublicError, .invalidPairingCode)
            }
        }
    }

    func testPairingResponseRequiresExactElevenFieldBinding() throws {
        let valid = Data(#"""
        {
          "ok":true,
          "schema_version":"evaos.mac_access.pairing_redeem_response.v1",
          "selected_binding":{
            "customer_id":"customer-01","customer_vm_id":"vm-01","device_id":"mac-01",
            "grant_id":"grant-01","runtime":"openclaw","binding_id":"binding-01",
            "binding_version":"v1","grant_expires_at":"2027-07-15T09:00:00Z",
            "connector_installation_id":"install-01","connector_key_id":"mac-key-01",
            "binding_fingerprint_sha256":"1111111111111111111111111111111111111111111111111111111111111111"
          },
          "relay_credential":"opaque-relay-credential",
          "relay_credential_expires_at":"2027-07-15T08:30:00Z",
          "audit_id":"audit-01"
        }
        """#.utf8)
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-15T08:00:00Z"))
        XCTAssertEqual(try MacAccessPairingRedemptionResponse.decodeStrict(from: valid, now: now).selectedBinding.runtime, "openclaw")

        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: valid) as? [String: Any])
        var binding = try XCTUnwrap(object["selected_binding"] as? [String: Any])
        binding["unexpected"] = true
        object["selected_binding"] = binding
        let invalid = try JSONSerialization.data(withJSONObject: object)
        XCTAssertThrowsError(try MacAccessPairingRedemptionResponse.decodeStrict(from: invalid, now: now)) {
            XCTAssertEqual($0 as? MacAccessPublicError, .invalidWireMessage)
        }
    }

    func testKeychainPolicyIsDeviceOnlyAndNonsynchronizable() {
        let policy = MacAccessKeychainPolicy.productionEpochOne
        XCTAssertEqual(policy.itemClass, "kSecClassGenericPassword")
        XCTAssertEqual(policy.accessibility, "kSecAttrAccessibleWhenUnlockedThisDeviceOnly")
        XCTAssertFalse(policy.synchronizable)
        XCTAssertTrue(policy.usesDataProtectionKeychain)
        XCTAssertEqual(policy.accessGroup, "TC6MS3T6NN.com.evaos.mac-access.credentials.epoch-1")
        XCTAssertEqual(
            MacAccessKeychainPolicy.developmentEpochOne.accessGroup,
            "TC6MS3T6NN.com.evaos.mac-access.development.credentials.epoch-1"
        )
#if DEBUG
        XCTAssertEqual(MacAccessKeychainPolicy.currentBuildEpochOne, .developmentEpochOne)
#else
        XCTAssertEqual(MacAccessKeychainPolicy.currentBuildEpochOne, .productionEpochOne)
#endif
    }
}
