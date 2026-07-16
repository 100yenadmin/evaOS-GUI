import Foundation
import XCTest
@testable import MacAccessShared

private actor StubXPCTransport: MacAccessXPCTransport {
    private let data: Data
    private let fails: Bool
    private(set) var requests: [(MacAccessXPCAction, String?)] = []

    init(reply: MacAccessXPCReply, fails: Bool = false) throws {
        data = try JSONEncoder().encode(reply)
        self.fails = fails
    }

    func request(_ action: MacAccessXPCAction, code: String?) throws -> Data {
        requests.append((action, code))
        if fails { throw CocoaError(.xpcConnectionInvalid) }
        return data
    }
}

private actor RecordingXPCServiceCore: MacAccessXPCServiceCore {
    private(set) var pairingCodes: [String] = []
    private(set) var stopCount = 0
    private(set) var revokeCount = 0

    func status() -> MacAccessXPCReply { okReply() }
    func pair(code: String) -> MacAccessXPCReply { pairingCodes.append(code); return okReply() }
    func connect() -> MacAccessXPCReply { okReply() }
    func disconnect() -> MacAccessXPCReply { okReply() }
    func stop() -> MacAccessXPCReply { stopCount += 1; return okReply() }
    func revoke() -> MacAccessXPCReply { revokeCount += 1; return okReply() }

    private func okReply() -> MacAccessXPCReply {
        MacAccessXPCReply(
            code: .ok,
            status: MacAccessXPCSafeStatus(
                pairing: "paired", transport: "connected", lastErrorCode: nil, lastAuditID: nil
            )
        )
    }
}

private actor XPCMemoryVault: MacAccessCredentialVault {
    enum Failure: Error { case erase }

    private let eraseFails: Bool
    private(set) var eraseCount = 0

    init(eraseFails: Bool = false) {
        self.eraseFails = eraseFails
    }

    func load() -> MacAccessCredentialRecord? { nil }
    func save(_ record: MacAccessCredentialRecord) {}
    func erase() throws {
        eraseCount += 1
        if eraseFails { throw Failure.erase }
    }
}

final class XPCTests: XCTestCase {
    func testClientForwardsPairingCodeAndMapsTypedReply() async throws {
        let transport = try StubXPCTransport(reply: MacAccessXPCReply(
            code: .ok,
            status: MacAccessXPCSafeStatus(
                pairing: "paired", transport: "disconnected", lastErrorCode: nil, lastAuditID: "audit-01"
            )
        ))
        let client = MacAccessXPCConnectorCoreClient(transport: transport)

        let result = await client.perform(.pair("ABCDEFGH2345"))
        XCTAssertEqual(result, .completed(.paired))
        let requests = await transport.requests
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests[0].0, .pair)
        XCTAssertEqual(requests[0].1, "ABCDEFGH2345")
    }

    func testClientInvalidationAndRedactedErrorMappingFailClosed() async throws {
        let failedTransport = try StubXPCTransport(reply: reply(.ok), fails: true)
        let failedClient = MacAccessXPCConnectorCoreClient(transport: failedTransport)
        let failedResult = await failedClient.perform(.connect)
        XCTAssertEqual(failedResult, .blocked(.relayUnavailable))

        let rejectedTransport = try StubXPCTransport(reply: reply(.invalidPairingCode))
        let rejectedClient = MacAccessXPCConnectorCoreClient(transport: rejectedTransport)
        let rejectedResult = await rejectedClient.perform(.pair("bad"))
        XCTAssertEqual(rejectedResult, .blocked(.invalidPairingCode))
    }

    func testServiceForwardsBoundedCodeStopAndRevoke() async throws {
        let core = RecordingXPCServiceCore()
        let service = MacAccessXPCService(core: core)

        let paired = await invoke { service.pair(code: "ABCDEFGH2345", withReply: $0) }
        XCTAssertEqual(try JSONDecoder().decode(MacAccessXPCReply.self, from: paired).code, .ok)
        _ = await invoke { service.stop(withReply: $0) }
        _ = await invoke { service.revoke(withReply: $0) }

        let pairingCodes = await core.pairingCodes
        let stopCount = await core.stopCount
        let revokeCount = await core.revokeCount
        XCTAssertEqual(pairingCodes, ["ABCDEFGH2345"])
        XCTAssertEqual(stopCount, 1)
        XCTAssertEqual(revokeCount, 1)

        let oversized = await invoke { service.pair(code: String(repeating: "A", count: 65), withReply: $0) }
        XCTAssertEqual(try JSONDecoder().decode(MacAccessXPCReply.self, from: oversized).code, .invalidPairingCode)
        let pairingCodesAfterOversized = await core.pairingCodes
        XCTAssertEqual(pairingCodesAfterOversized, ["ABCDEFGH2345"])
    }

    func testCallerPolicyAllowsOnlyFrozenMainAppRequirement() {
        XCTAssertEqual(
            MacAccessXPCCallerPolicy.designatedRequirement(for: MacAccessIdentity.appBundleID),
            MacAccessIdentity.appDesignatedRequirement
        )
        XCTAssertNil(
            MacAccessXPCCallerPolicy.designatedRequirement(for: MacAccessIdentity.connectorServiceID)
        )
        XCTAssertNil(MacAccessXPCCallerPolicy.designatedRequirement(for: "com.example.untrusted"))
        XCTAssertTrue(MacAccessXPCCallerPolicy.combinedRequirement.contains(MacAccessIdentity.appDesignatedRequirement))
        XCTAssertFalse(MacAccessXPCCallerPolicy.combinedRequirement.contains(MacAccessIdentity.connectorDesignatedRequirement))
        XCTAssertFalse(MacAccessXPCCallerPolicy.combinedRequirement.contains("workbench"))
    }

    func testDeploymentConfigurationRequiresAllInjectedIndependentInputs() throws {
        XCTAssertNil(MacAccessHelperDeploymentConfiguration(dictionary: [:]))
        let commandKey = MacAccessWire.base64URL(Data(repeating: 1, count: 32))
        let contextKey = MacAccessWire.base64URL(Data(repeating: 2, count: 32))
        let valid: [String: Any] = [
            "MacAccessPairingEndpoint": "https://dashboard.example.test/api/mac-access/pair",
            "MacAccessRelayURL": "wss://relay.example.test/mac-access-relay/v1",
            "MacAccessCommandKeyID": "command-key-01",
            "MacAccessCommandPublicKeyBase64URL": commandKey,
            "MacAccessExecutionContextKeyID": "context-key-01",
            "MacAccessExecutionContextPublicKeyBase64URL": contextKey,
        ]
        XCTAssertNotNil(MacAccessHelperDeploymentConfiguration(dictionary: valid))

        var sameKey = valid
        sameKey["MacAccessExecutionContextPublicKeyBase64URL"] = commandKey
        XCTAssertNil(MacAccessHelperDeploymentConfiguration(dictionary: sameKey))
    }

    func testMissingConfigurationStopPreservesVaultAndRevokeErases() async throws {
        let vault = XPCMemoryVault()
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("mac-access-xpc-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let paths = MacAccessPolicyPaths(directory: directory)
        let custody = try MacAccessPolicyCustody(paths: paths, hostSessionID: "host-before-uninstall")
        let core = MacAccessRuntimeXPCServiceCore(
            vault: vault,
            runtime: nil,
            policyRuntime: nil,
            safetyCustody: custody
        )

        let stopped = await core.stop()
        let revoked = await core.revoke()
        XCTAssertEqual(stopped.code, .configurationUnavailable)
        XCTAssertEqual(revoked.code, .ok)
        let eraseCount = await vault.eraseCount
        XCTAssertEqual(eraseCount, 1)

        let reinstalled = try MacAccessPolicyCustody(paths: paths, hostSessionID: "host-after-reinstall")
        let projection = await reinstalled.projectStatus()
        XCTAssertEqual(projection.pairing, "revoked")
        XCTAssertEqual(projection.effectiveMode, "off")
        XCTAssertEqual(projection.transport, "revoked")
    }

    func testRevokeErasesCredentialButFailsClosedWhenTombstoneCannotPersist() async {
        let vault = XPCMemoryVault()
        let core = MacAccessRuntimeXPCServiceCore(
            vault: vault,
            runtime: nil,
            policyRuntime: nil,
            safetyCustody: nil
        )

        let revoked = await core.revoke()
        let eraseCount = await vault.eraseCount
        XCTAssertEqual(revoked.code, .policyUnavailable)
        XCTAssertEqual(eraseCount, 1)
    }

    func testRevokePersistsTombstoneEvenWhenCredentialEraseFails() async throws {
        let vault = XPCMemoryVault(eraseFails: true)
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("mac-access-xpc-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let paths = MacAccessPolicyPaths(directory: directory)
        let custody = try MacAccessPolicyCustody(paths: paths, hostSessionID: "host-erase-failure")
        let core = MacAccessRuntimeXPCServiceCore(
            vault: vault,
            runtime: nil,
            policyRuntime: nil,
            safetyCustody: custody
        )

        let revoked = await core.revoke()
        XCTAssertEqual(revoked.code, .credentialUnavailable)
        let eraseCount = await vault.eraseCount
        XCTAssertEqual(eraseCount, 1)
        let projection = await custody.projectStatus()
        XCTAssertEqual(projection.pairing, "revoked")
        XCTAssertEqual(projection.effectiveMode, "off")
        XCTAssertEqual(projection.transport, "revoked")
    }

    private func reply(_ code: MacAccessXPCReplyCode) -> MacAccessXPCReply {
        MacAccessXPCReply(
            code: code,
            status: MacAccessXPCSafeStatus(
                pairing: "unpaired", transport: "blocked", lastErrorCode: code.rawValue, lastAuditID: nil
            )
        )
    }

    private func invoke(_ operation: (@escaping @Sendable (Data) -> Void) -> Void) async -> Data {
        await withCheckedContinuation { continuation in
            operation { continuation.resume(returning: $0) }
        }
    }
}
