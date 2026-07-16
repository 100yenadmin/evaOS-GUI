import Foundation
import MacAccessShared

enum MacAccessXPCCallerPolicy {
    static let allowedBundleIDs = [MacAccessIdentity.appBundleID]
    static let combinedRequirement = MacAccessIdentity.appDesignatedRequirement

    static func designatedRequirement(for bundleID: String) -> String? {
        switch bundleID {
        case MacAccessIdentity.appBundleID: MacAccessIdentity.appDesignatedRequirement
        default: nil
        }
    }
}

protocol MacAccessXPCServiceCore: Sendable {
    func status() async -> MacAccessXPCReply
    func pair(code: String) async -> MacAccessXPCReply
    func connect() async -> MacAccessXPCReply
    func disconnect() async -> MacAccessXPCReply
    func stop() async -> MacAccessXPCReply
    func revoke() async -> MacAccessXPCReply
    func policy(_ request: MacAccessXPCPolicyRequest) async -> MacAccessXPCReply
}

extension MacAccessXPCServiceCore {
    func policy(_ request: MacAccessXPCPolicyRequest) async -> MacAccessXPCReply {
        MacAccessXPCReply(
            code: .policyUnavailable,
            status: MacAccessXPCSafeStatus(
                pairing: "unpaired", transport: "blocked",
                lastErrorCode: "policy_unavailable", lastAuditID: nil
            )
        )
    }
}

actor MacAccessPolicyRuntime: MacAccessTransportSafetySink {
    let client: MacAccessCoreHostClient
    private let custody: MacAccessPolicyCustody
    private let audit: MacAccessAuditCustody
    private let native: MacAccessNativeClickPort

    init(
        client: MacAccessCoreHostClient,
        custody: MacAccessPolicyCustody,
        audit: MacAccessAuditCustody,
        native: MacAccessNativeClickPort
    ) {
        self.client = client
        self.custody = custody
        self.audit = audit
        self.native = native
    }

    func synchronizePairing(code: String) async throws {
        _ = try await client.perform(operation: "pair", extras: [
            "pairing_code": .string(code),
            "local_installation_nonce": .string(MacAccessWire.base64URL(try MacAccessWire.randomBytes(count: 32))),
        ])
    }

    func synchronizeConnection(binding: MacAccessSelectedBinding) async throws {
        let data = try JSONEncoder().encode(binding)
        guard case .object(let object) = try JSONDecoder().decode(JSONValue.self, from: data) else {
            throw MacAccessCoreHostError.protocolViolation
        }
        _ = try await client.perform(operation: "connect", extras: ["binding": .object(object)])
    }

    func synchronize(_ operation: String) async throws {
        _ = try await client.perform(operation: operation)
    }

    func preemptSafety(_ operation: String) async throws {
        await native.blockAndCancelAll()
        await client.resetPolicyEpoch()
        _ = try await custody.forceLocalSafety(operation)
    }

    func preemptTransportSafety(_ event: MacAccessTransportSafetyEvent) async throws {
        switch event {
        case .grantRevoked, .grantExpired:
            try await preemptSafety("revoke")
        case .channelClosed:
            try await preemptSafety("disconnect")
        }
    }

    func prepareForPairing() async throws {
        try await preemptSafety("revoke")
    }

    func enableNativeIfAllowed() async {
        if await custody.openNativeBarrierIfAllowed() {
            await native.allowActions()
        } else {
            await native.blockAndCancelAll()
        }
    }

    func clearEmergencyKill(expectedPolicyEpoch: Int64) async throws {
        await native.blockAndCancelAll()
        await client.shutdown()
        try await client.recoverUnauditedTerminalOutcomesForEmergencyReset()
        _ = try await custody.clearEmergencyKill(expectedPolicyEpoch: expectedPolicyEpoch)
        await client.resetPolicyEpoch()
    }

    func emergencyKillEpoch() async -> Int64? {
        let projection = await custody.projectStatus()
        return projection.killSwitch ? projection.policyEpoch : nil
    }

    func latchEmergencyKill() async {
        _ = try? await custody.activateEmergencyKill()
        await native.blockAndCancelAll()
        await client.resetPolicyEpoch()
    }

    func prepareForFreshPairingIfRevoked() async throws {
        let projection = await custody.projectStatus()
        guard projection.pairing == "revoked" else { return }
        _ = try await custody.prepareRevokedStateForFreshPairing()
        await client.resetPolicyEpoch()
    }

    func isEmergencyKillActive() async -> Bool {
        await custody.projectStatus().killSwitch
    }

    func perform(_ request: MacAccessXPCPolicyRequest) async -> MacAccessXPCReplyCode {
        do {
            switch request.operation {
            case .setAccessMode:
                guard let mode = request.mode,
                      ["off", "ask_every_time", "full_access"].contains(mode)
                else { return .invalidRequest }
                if mode == "off" {
                    try await preemptSafety("off")
                } else if mode == "full_access" {
                    let current = await custody.projectStatus().policyEpoch
                    guard current < 9_007_199_254_740_991 else { return .policyUnavailable }
                    try await custody.confirmFullAccess(policyEpoch: current + 1)
                }
                do {
                    _ = try await client.perform(
                        operation: "set_access_mode", extras: ["target_mode": .string(mode)]
                    )
                } catch {
                    try? await custody.invalidateAuthorityAndPersist()
                    throw error
                }
                if mode != "off" {
                    try await custody.authorizeLocalMode(mode)
                    await enableNativeIfAllowed()
                }
            case .pause:
                try await preemptSafety("pause")
                _ = try await client.perform(operation: "pause")
            case .resume:
                _ = try await client.perform(operation: "resume")
                await enableNativeIfAllowed()
            case .activateKillSwitch:
                do {
                    _ = try await custody.activateEmergencyKill()
                } catch {
                    await native.blockAndCancelAll()
                    await client.resetPolicyEpoch()
                    throw error
                }
                await native.blockAndCancelAll()
                await client.resetPolicyEpoch()
                _ = try? await client.perform(operation: "activate_kill_switch")
            case .clearKillSwitch:
                return .invalidRequest
            case .approveAction:
                guard let approval = request.approval else { return .invalidRequest }
                guard await custody.resolvePendingApproval(approval, allow: true) else {
                    return .invalidRequest
                }
            case .denyAction:
                guard let approval = request.approval,
                      await custody.resolvePendingApproval(approval, allow: false)
                else { return .invalidRequest }
            case .auditSummary:
                guard request.auditLimit.map({ (1...100).contains($0) }) ?? true else {
                    return .invalidRequest
                }
            }
            return .ok
        } catch {
            return .policyUnavailable
        }
    }

    func safeStatus(
        pairing: String,
        transport: String,
        lastErrorCode: String?,
        lastAuditID: String?
    ) async -> MacAccessXPCSafeStatus {
        let projection = await custody.projectStatus()
        return MacAccessXPCSafeStatus(
            pairing: projection.pairing,
            transport: projection.transport,
            lastErrorCode: lastErrorCode,
            lastAuditID: lastAuditID,
            configuredMode: projection.configuredMode,
            effectiveMode: projection.effectiveMode,
            paused: projection.paused,
            killSwitch: projection.killSwitch,
            policyEpoch: projection.policyEpoch,
            policyProvider: "mac_connector_core",
            auditEventCount: await audit.eventCount(),
            pendingApproval: await custody.currentPendingApproval(),
            recentAuditEvents: await audit.recentSafeEvents()
        )
    }
}

private struct MacAccessPolicyComposition {
    let runtime: MacAccessPolicyRuntime
    let executor: CoreHostBackedMacAccessExecutor

    static func production(
        vault: any MacAccessCredentialVault,
        pinnedKeys: MacAccessPinnedKeys,
        bundle: Bundle = .main
    ) throws -> Self {
        let hostSessionID = "host-\(UUID().uuidString.lowercased())"
        let paths = try MacAccessPolicyPaths.production()
        let custody = try MacAccessPolicyCustody(paths: paths, hostSessionID: hostSessionID)
        let audit = try MacAccessAuditCustody.production(paths: paths)
        let native = MacAccessNativeClickPort(initiallyBlocked: true)
        let dispatcher = MacAccessCoreHostPortDispatcher(
            custody: custody, audit: audit, native: native, vault: vault, pinnedKeys: pinnedKeys
        )
        let transport = MacAccessStdioCoreHostTransport(
            launcher: MacAccessStdioCoreHostTransport.productionLauncher(
                hostSessionID: hostSessionID, bundle: bundle
            ),
            dispatcher: dispatcher
        )
        let client = MacAccessCoreHostClient(
            transport: transport, hostSessionID: hostSessionID, custody: custody
        )
        return Self(
            runtime: MacAccessPolicyRuntime(
                client: client, custody: custody, audit: audit, native: native
            ),
            executor: CoreHostBackedMacAccessExecutor(
                client: client, audit: audit, custody: custody
            )
        )
    }
}

struct MacAccessHelperDeploymentConfiguration: Equatable, Sendable {
    let pairingEndpoint: URL
    let relayURL: URL
    let pinnedKeys: MacAccessPinnedKeys

    init?(dictionary: [String: Any]) {
        guard let pairingString = dictionary["MacAccessPairingEndpoint"] as? String,
              let pairingEndpoint = URL(string: pairingString), pairingEndpoint.scheme == "https",
              let relayString = dictionary["MacAccessRelayURL"] as? String,
              let relayURL = URL(string: relayString), relayURL.scheme == "wss",
              relayURL.path == MacAccessWire.relayPath, relayURL.query == nil, relayURL.fragment == nil,
              let commandKeyID = dictionary["MacAccessCommandKeyID"] as? String,
              let commandKeyString = dictionary["MacAccessCommandPublicKeyBase64URL"] as? String,
              let commandKey = try? MacAccessWire.decodeBase64URL(commandKeyString), commandKey.count == 32,
              let contextKeyID = dictionary["MacAccessExecutionContextKeyID"] as? String,
              let contextKeyString = dictionary["MacAccessExecutionContextPublicKeyBase64URL"] as? String,
              let contextKey = try? MacAccessWire.decodeBase64URL(contextKeyString), contextKey.count == 32,
              MacAccessWire.isIdentifier(commandKeyID), MacAccessWire.isIdentifier(contextKeyID),
              commandKeyID != contextKeyID, commandKey != contextKey
        else { return nil }
        self.pairingEndpoint = pairingEndpoint
        self.relayURL = relayURL
        pinnedKeys = MacAccessPinnedKeys(
            commandKeyID: commandKeyID,
            commandPublicKey: commandKey,
            executionContextPublicKeys: [contextKeyID: contextKey]
        )
    }

    static func load(bundle: Bundle = .main) -> Self? {
        guard let dictionary = bundle.infoDictionary else { return nil }
        return Self(dictionary: dictionary)
    }
}

actor MacAccessRuntimeXPCServiceCore: MacAccessXPCServiceCore {
    private let vault: any MacAccessCredentialVault
    private let runtime: MacAccessHelperRuntime?
    private let policyRuntime: MacAccessPolicyRuntime?
    private let safetyCustody: MacAccessPolicyCustody?
    private let policyRequired: Bool

    init(
        configuration: MacAccessHelperDeploymentConfiguration?,
        vault: any MacAccessCredentialVault = SecurityMacAccessCredentialVault(),
        enablePolicyRuntime: Bool = false,
        bundle: Bundle = .main
    ) {
        self.vault = vault
        policyRequired = enablePolicyRuntime
        let policy = enablePolicyRuntime ? configuration.flatMap {
            try? MacAccessPolicyComposition.production(
                vault: vault, pinnedKeys: $0.pinnedKeys, bundle: bundle
            )
        } : nil
        policyRuntime = policy?.runtime
        safetyCustody = policy == nil ? Self.makeSafetyCustody() : nil
        guard let configuration else {
            runtime = nil
            return
        }
        runtime = MacAccessHelperRuntime(
            vault: vault,
            redeemer: URLSessionMacAccessPairingRedeemer(endpoint: configuration.pairingEndpoint),
            socketFactory: URLSessionMacAccessRelaySocketFactory(),
            executor: policy?.executor ?? PolicyUnavailableMacAccessExecutor(),
            safetySink: policy?.runtime,
            pinnedKeys: configuration.pinnedKeys,
            relayURL: configuration.relayURL
        )
    }

    init(
        vault: any MacAccessCredentialVault,
        runtime: MacAccessHelperRuntime?,
        policyRuntime: MacAccessPolicyRuntime?,
        safetyCustody: MacAccessPolicyCustody? = nil,
        policyRequired: Bool = true
    ) {
        self.vault = vault
        self.runtime = runtime
        self.policyRuntime = policyRuntime
        self.safetyCustody = safetyCustody
        self.policyRequired = policyRequired
    }

    func status() async -> MacAccessXPCReply {
        guard let runtime else { return await unavailableReply() }
        guard !policyRequired || policyRuntime != nil else {
            return await reply(code: .policyUnavailable, status: await runtime.status)
        }
        return await reply(code: .ok, status: await runtime.status)
    }

    func pair(code: String) async -> MacAccessXPCReply {
        guard code.utf8.count <= 64 else { return await reply(code: .invalidPairingCode) }
        guard let normalizedCode = try? MacAccessPairingCode.normalize(code) else {
            return await reply(code: .invalidPairingCode)
        }
        guard let runtime else { return await unavailableReply() }
        guard let policyRuntime else {
            return await reply(code: .policyUnavailable, status: await runtime.status)
        }
        do {
            try await policyRuntime.prepareForPairing()
        } catch {
            await policyRuntime.latchEmergencyKill()
            return await reply(code: .policyUnavailable, status: await runtime.status)
        }
        do {
            let status = try await runtime.pair(code: normalizedCode)
            do {
                try await policyRuntime.prepareForFreshPairingIfRevoked()
                try await policyRuntime.synchronizePairing(code: normalizedCode)
            } catch {
                try await rollbackPairing(runtime: runtime, policyRuntime: policyRuntime)
                throw MacAccessPublicError.policyUnavailable
            }
            return await reply(code: .ok, status: status)
        } catch {
            return await reply(code: map(error), status: await runtime.status)
        }
    }

    func connect() async -> MacAccessXPCReply {
        guard let runtime else { return await unavailableReply() }
        guard let policyRuntime else {
            return await reply(code: .policyUnavailable, status: await runtime.status)
        }
        guard let binding = try? await vault.load()?.binding else {
            return await reply(code: .policyUnavailable, status: await runtime.status)
        }
        do {
            let status = try await runtime.connect()
            do {
                try await policyRuntime.synchronizeConnection(binding: binding)
                await policyRuntime.enableNativeIfAllowed()
            } catch {
                _ = try? await runtime.stop()
                throw MacAccessPublicError.policyUnavailable
            }
            Task {
                await runtime.processCommands()
            }
            return await reply(code: .ok, status: status)
        } catch {
            return await reply(code: map(error), status: await runtime.status)
        }
    }

    func disconnect() async -> MacAccessXPCReply {
        guard let runtime else { return await unavailableReply() }
        guard let policyRuntime else { return await reply(code: .policyUnavailable, status: await runtime.status) }
        do { try await policyRuntime.preemptSafety("disconnect") }
        catch { return await reply(code: .policyUnavailable, status: await runtime.status) }
        let status = await runtime.disconnect()
        do { try await policyRuntime.synchronize("disconnect") }
        catch { return await reply(code: .policyUnavailable, status: status) }
        return await reply(code: .ok, status: status)
    }

    func stop() async -> MacAccessXPCReply {
        guard let runtime else { return await unavailableReply() }
        guard let policyRuntime else { return await reply(code: .policyUnavailable, status: await runtime.status) }
        do {
            try await policyRuntime.preemptSafety("stop")
            let status = try await runtime.stop()
            try await policyRuntime.synchronize("stop")
            return await reply(code: .ok, status: status)
        } catch {
            return await reply(code: map(error), status: await runtime.status)
        }
    }

    func revoke() async -> MacAccessXPCReply {
        guard let runtime else {
            guard let safetyCustody else {
                try? await vault.erase()
                return MacAccessXPCReply(
                    code: .policyUnavailable,
                    status: (await unavailableReply()).status
                )
            }
            do {
                _ = try await safetyCustody.forceLocalSafety("revoke")
            } catch {
                try? await vault.erase()
                return MacAccessXPCReply(
                    code: .policyUnavailable,
                    status: (await unavailableReply()).status
                )
            }
            do {
                try await vault.erase()
                return MacAccessXPCReply(
                    code: .ok,
                    status: MacAccessXPCSafeStatus(
                        pairing: "revoked", transport: "stopped",
                        lastErrorCode: "revoked", lastAuditID: nil
                    )
                )
            } catch {
                return MacAccessXPCReply(
                    code: .credentialUnavailable,
                    status: (await unavailableReply()).status
                )
            }
        }
        guard let policyRuntime else {
            guard let safetyCustody else {
                _ = try? await runtime.revokeLocally()
                return await reply(code: .policyUnavailable, status: await runtime.status)
            }
            do {
                _ = try await safetyCustody.forceLocalSafety("revoke")
            } catch {
                _ = try? await runtime.revokeLocally()
                return await reply(code: .policyUnavailable, status: await runtime.status)
            }
            do {
                let status = try await runtime.revokeLocally()
                return await reply(code: .ok, status: status)
            } catch {
                return await reply(code: map(error), status: await runtime.status)
            }
        }
        do {
            try await policyRuntime.preemptSafety("revoke")
            let status = try await runtime.revokeLocally()
            try await policyRuntime.synchronize("revoke")
            return await reply(code: .ok, status: status)
        } catch {
            return await reply(code: map(error), status: await runtime.status)
        }
    }

    func policy(_ request: MacAccessXPCPolicyRequest) async -> MacAccessXPCReply {
        guard let policyRuntime else { return await unavailableReply() }
        if request.operation == .clearKillSwitch {
            guard let killedEpoch = await policyRuntime.emergencyKillEpoch() else {
                return await reply(code: .invalidRequest, status: await runtime?.status ?? .initial)
            }
            do {
                if let runtime { _ = try await runtime.revokeLocally() }
                else { try await vault.erase() }
                try await policyRuntime.clearEmergencyKill(expectedPolicyEpoch: killedEpoch)
                let resetStatus = await runtime?.completeEmergencyReset() ?? .initial
                return await reply(code: .ok, status: resetStatus)
            } catch {
                return await reply(code: map(error), status: await runtime?.status ?? .initial)
            }
        }
        let code = await policyRuntime.perform(request)
        if request.operation == .activateKillSwitch { _ = try? await runtime?.stop() }
        return await reply(code: code, status: await runtime?.status ?? .initial)
    }

    private func unavailableReply() async -> MacAccessXPCReply {
        if let policyRuntime {
            return MacAccessXPCReply(
                code: .configurationUnavailable,
                status: await policyRuntime.safeStatus(
                    pairing: "unpaired", transport: "blocked",
                    lastErrorCode: "configuration_unavailable", lastAuditID: nil
                )
            )
        }
        return MacAccessXPCReply(
            code: .configurationUnavailable,
            status: MacAccessXPCSafeStatus(
                pairing: "unpaired", transport: "blocked",
                lastErrorCode: "configuration_unavailable", lastAuditID: nil
            )
        )
    }

    private func rollbackPairing(
        runtime: MacAccessHelperRuntime,
        policyRuntime: MacAccessPolicyRuntime?
    ) async throws {
        try? await policyRuntime?.preemptSafety("revoke")
        do {
            _ = try await runtime.revokeLocally()
        } catch {
            await policyRuntime?.latchEmergencyKill()
            throw MacAccessPublicError.credentialUnavailable
        }
    }

    private func reply(
        code: MacAccessXPCReplyCode,
        status: MacAccessHelperSafeStatus = .initial
    ) async -> MacAccessXPCReply {
        if let policyRuntime {
            return MacAccessXPCReply(
                code: code,
                status: await policyRuntime.safeStatus(
                    pairing: status.pairing.rawValue,
                    transport: status.transport.rawValue,
                    lastErrorCode: status.lastError?.rawValue,
                    lastAuditID: status.lastAuditID
                )
            )
        }
        return MacAccessXPCReply(
            code: code,
            status: MacAccessXPCSafeStatus(
                pairing: status.pairing.rawValue,
                transport: status.transport.rawValue,
                lastErrorCode: status.lastError?.rawValue,
                lastAuditID: status.lastAuditID
            )
        )
    }

    private func map(_ error: Error) -> MacAccessXPCReplyCode {
        guard let error = error as? MacAccessPublicError else { return .relayUnavailable }
        switch error {
        case .invalidPairingCode: return .invalidPairingCode
        case .pairingRejected: return .pairingRejected
        case .credentialUnavailable: return .credentialUnavailable
        case .relayUnavailable: return .relayUnavailable
        case .policyUnavailable: return .policyUnavailable
        case .revoked: return .revoked
        case .stopped: return .stopped
        case .invalidWireMessage, .invalidUnicode, .unsafeInteger, .wrongBinding,
             .digestMismatch, .signatureMismatch, .expiredAuthority, .replayRejected:
            return .commandRejected
        }
    }

    private static func makeSafetyCustody() -> MacAccessPolicyCustody? {
        guard let paths = try? MacAccessPolicyPaths.production() else { return nil }
        return try? MacAccessPolicyCustody(
            paths: paths,
            hostSessionID: "host-\(UUID().uuidString.lowercased())"
        )
    }
}

final class MacAccessXPCService: NSObject, MacAccessXPCServiceProtocol, @unchecked Sendable {
    static let maximumReplyBytes = 4 << 10
    private let core: any MacAccessXPCServiceCore

    init(core: any MacAccessXPCServiceCore) {
        self.core = core
    }

    func status(withReply reply: @escaping @Sendable (Data) -> Void) {
        respond(reply) { await self.core.status() }
    }

    func pair(code: String, withReply reply: @escaping @Sendable (Data) -> Void) {
        guard code.utf8.count <= 64 else {
            respond(reply) {
                MacAccessXPCReply(
                    code: .invalidPairingCode,
                    status: MacAccessXPCSafeStatus(
                        pairing: "unpaired", transport: "blocked",
                        lastErrorCode: "invalid_pairing_code", lastAuditID: nil
                    )
                )
            }
            return
        }
        respond(reply) { await self.core.pair(code: code) }
    }

    func connect(withReply reply: @escaping @Sendable (Data) -> Void) {
        respond(reply) { await self.core.connect() }
    }

    func disconnect(withReply reply: @escaping @Sendable (Data) -> Void) {
        respond(reply) { await self.core.disconnect() }
    }

    func stop(withReply reply: @escaping @Sendable (Data) -> Void) {
        respond(reply) { await self.core.stop() }
    }

    func revoke(withReply reply: @escaping @Sendable (Data) -> Void) {
        respond(reply) { await self.core.revoke() }
    }

    func policy(request: Data, withReply reply: @escaping @Sendable (Data) -> Void) {
        guard request.count <= Self.maximumReplyBytes,
              let decoded = try? JSONDecoder().decode(MacAccessXPCPolicyRequest.self, from: request)
        else {
            respond(reply) {
                MacAccessXPCReply(
                    code: .invalidRequest,
                    status: MacAccessXPCSafeStatus(
                        pairing: "unpaired", transport: "blocked",
                        lastErrorCode: "invalid_request", lastAuditID: nil
                    )
                )
            }
            return
        }
        respond(reply) { await self.core.policy(decoded) }
    }

    private func respond(
        _ callback: @escaping @Sendable (Data) -> Void,
        operation: @escaping @Sendable () async -> MacAccessXPCReply
    ) {
        Task {
            let result = await operation()
            let encoded = (try? JSONEncoder().encode(result)) ?? Data()
            callback(encoded.count <= Self.maximumReplyBytes ? encoded : Data())
        }
    }
}

final class MacAccessXPCListenerDelegate: NSObject, NSXPCListenerDelegate {
    private let service: MacAccessXPCService

    init(core: any MacAccessXPCServiceCore = MacAccessRuntimeXPCServiceCore(
        configuration: MacAccessHelperDeploymentConfiguration.load(), enablePolicyRuntime: true
    )) {
        service = MacAccessXPCService(core: core)
    }

    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        connection.setCodeSigningRequirement(MacAccessXPCCallerPolicy.combinedRequirement)
        connection.exportedInterface = NSXPCInterface(with: MacAccessXPCServiceProtocol.self)
        connection.exportedObject = service
        connection.resume()
        return true
    }
}
