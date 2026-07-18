import ApplicationServices
import CoreGraphics
import Foundation
import MacAccessShared
import XPC

enum MacAccessXPCCallerPolicy {
    static let allowedBundleIDs = [MacAccessIdentity.appBundleID, MacAccessIdentity.connectorServiceID]
    static let combinedRequirement =
        "(\(MacAccessIdentity.appDesignatedRequirement)) or (\(MacAccessIdentity.connectorDesignatedRequirement))"

    static func designatedRequirement(for bundleID: String) -> String? {
        switch bundleID {
        case MacAccessIdentity.appBundleID: MacAccessIdentity.appDesignatedRequirement
        case MacAccessIdentity.connectorServiceID: MacAccessIdentity.connectorDesignatedRequirement
        default: nil
        }
    }
}

actor MacAccessXPCTransactionActivity: MacAccessRelayActivity {
    private var active = false

    func begin() {
        guard !active else { return }
        xpc_transaction_begin()
        active = true
    }

    func end() {
        guard active else { return }
        active = false
        xpc_transaction_end()
    }
}

private final class MacAccessApprovalReplyGate: @unchecked Sendable {
    private let lock = NSLock()
    private var resolved = false

    func resolve(_ operation: () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        guard !resolved else { return }
        resolved = true
        operation()
    }
}

fileprivate final class MacAccessXPCApprovalProxy: @unchecked Sendable {
    let id = UUID()
    private let proxy: any MacAccessXPCApprovalProtocol

    init(proxy: any MacAccessXPCApprovalProtocol) {
        self.proxy = proxy
    }

    func requestApproval(_ request: MacAccessApprovalRequest) async -> Bool {
        guard let encoded = try? JSONEncoder().encode(request), encoded.count <= 4 << 10 else {
            return false
        }
        return await withCheckedContinuation { continuation in
            let gate = MacAccessApprovalReplyGate()
            proxy.requestApproval(encoded) { data in
                gate.resolve {
                    let reply = try? JSONDecoder().decode(MacAccessApprovalReply.self, from: data)
                    continuation.resume(
                        returning: reply?.requestID == request.requestID && reply?.approved == true
                    )
                }
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + 30) {
                gate.resolve { continuation.resume(returning: false) }
            }
        }
    }
}

actor MacAccessApprovalBroker: MacAccessApprovalRequesting {
    private var provider: MacAccessXPCApprovalProxy?

    fileprivate func install(_ provider: MacAccessXPCApprovalProxy) {
        self.provider = provider
    }

    fileprivate func clear(providerID: UUID) {
        guard provider?.id == providerID else { return }
        provider = nil
    }

    func requestApproval(_ request: MacAccessApprovalRequest) async -> Bool {
        guard let provider else { return false }
        return await provider.requestApproval(request)
    }
}

protocol MacAccessXPCServiceCore: Sendable {
    func status() async -> MacAccessXPCReply
    func pair(code: String) async -> MacAccessXPCReply
    func connect() async -> MacAccessXPCReply
    func disconnect() async -> MacAccessXPCReply
    func stop() async -> MacAccessXPCReply
    func revoke() async -> MacAccessXPCReply
    func setAccessMode(_ mode: MacAccessMode) async -> MacAccessXPCReply
    func requestPermission(_ kind: MacAccessPermissionKind) async -> MacAccessXPCReply
}

protocol MacAccessPermissionAuthorizing: Sendable {
    func currentStatus() async -> MacAccessPermissionStatus
    func request(_ kind: MacAccessPermissionKind) async -> MacAccessPermissionStatus
}

struct HelperMacAccessPermissionAuthorizer: MacAccessPermissionAuthorizing {
    func currentStatus() async -> MacAccessPermissionStatus {
        await MainActor.run {
            MacAccessPermissionStatus(
                accessibility: AXIsProcessTrusted() ? .granted : .denied,
                screenRecording: CGPreflightScreenCaptureAccess() ? .granted : .denied
            )
        }
    }

    func request(_ kind: MacAccessPermissionKind) async -> MacAccessPermissionStatus {
        await MainActor.run {
            switch kind {
            case .accessibility:
                _ = AXIsProcessTrustedWithOptions(
                    ["AXTrustedCheckOptionPrompt": true] as CFDictionary
                )
            case .screenRecording:
                _ = CGRequestScreenCaptureAccess()
            }
            return MacAccessPermissionStatus(
                accessibility: AXIsProcessTrusted() ? .granted : .denied,
                screenRecording: CGPreflightScreenCaptureAccess() ? .granted : .denied
            )
        }
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
    private let permissionAuthorizer: any MacAccessPermissionAuthorizing

    init(
        configuration: MacAccessHelperDeploymentConfiguration?,
        vault: any MacAccessCredentialVault = SecurityMacAccessCredentialVault(),
        relayActivity: any MacAccessRelayActivity = MacAccessXPCTransactionActivity(),
        permissionAuthorizer: any MacAccessPermissionAuthorizing = HelperMacAccessPermissionAuthorizer(),
        approvalRequester: (any MacAccessApprovalRequesting)? = nil
    ) {
        self.vault = vault
        self.permissionAuthorizer = permissionAuthorizer
        guard let configuration else {
            runtime = nil
            return
        }
        runtime = MacAccessHelperRuntime(
            vault: vault,
            redeemer: URLSessionMacAccessPairingRedeemer(endpoint: configuration.pairingEndpoint),
            socketFactory: URLSessionMacAccessRelaySocketFactory(),
            executor: MacAccessBridgeCommandExecutor(),
            pinnedKeys: configuration.pinnedKeys,
            relayURL: configuration.relayURL,
            relayActivity: relayActivity,
            policy: MacAccessCommandPolicy(approver: approvalRequester)
        )
    }

    func status() async -> MacAccessXPCReply {
        guard let runtime else { return unavailableReply() }
        return reply(
            code: .ok,
            status: await runtime.refreshStatusFromVault(),
            permissions: await permissionAuthorizer.currentStatus(),
            accessMode: await runtime.accessMode()
        )
    }

    func pair(code: String) async -> MacAccessXPCReply {
        guard code.utf8.count <= 64 else { return reply(code: .invalidPairingCode) }
        guard let runtime else { return unavailableReply() }
        do {
            return reply(
                code: .ok,
                status: try await runtime.pair(code: code),
                accessMode: await runtime.accessMode()
            )
        } catch {
            return reply(
                code: map(error),
                status: await runtime.status,
                accessMode: await runtime.accessMode()
            )
        }
    }

    func connect() async -> MacAccessXPCReply {
        guard let runtime else { return unavailableReply() }
        do {
            let status = try await runtime.connect()
            Task {
                await runtime.processCommands()
            }
            return reply(code: .ok, status: status, accessMode: await runtime.accessMode())
        } catch {
            return reply(
                code: map(error),
                status: await runtime.status,
                accessMode: await runtime.accessMode()
            )
        }
    }

    func disconnect() async -> MacAccessXPCReply {
        guard let runtime else { return unavailableReply() }
        return reply(
            code: .ok,
            status: await runtime.disconnect(),
            accessMode: await runtime.accessMode()
        )
    }

    func stop() async -> MacAccessXPCReply {
        guard let runtime else { return unavailableReply() }
        do {
            return reply(
                code: .ok,
                status: try await runtime.stop(),
                accessMode: await runtime.accessMode()
            )
        } catch {
            return reply(
                code: map(error),
                status: await runtime.status,
                accessMode: await runtime.accessMode()
            )
        }
    }

    func revoke() async -> MacAccessXPCReply {
        guard let runtime else {
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
                    status: unavailableReply().status
                )
            }
        }
        do {
            return reply(
                code: .ok,
                status: try await runtime.revokeLocally(),
                accessMode: await runtime.accessMode()
            )
        } catch {
            return reply(
                code: map(error),
                status: await runtime.status,
                accessMode: await runtime.accessMode()
            )
        }
    }

    func setAccessMode(_ mode: MacAccessMode) async -> MacAccessXPCReply {
        guard let runtime else { return unavailableReply() }
        await runtime.setAccessMode(mode)
        return reply(
            code: .ok,
            status: await runtime.status,
            accessMode: mode
        )
    }

    func requestPermission(_ kind: MacAccessPermissionKind) async -> MacAccessXPCReply {
        let permissions = await permissionAuthorizer.request(kind)
        let status = if let runtime {
            await runtime.refreshStatusFromVault()
        } else {
            MacAccessHelperSafeStatus.initial
        }
        let accessMode = if let runtime {
            await runtime.accessMode()
        } else {
            MacAccessMode.off
        }
        return reply(
            code: .ok,
            status: status,
            permissions: permissions,
            accessMode: accessMode
        )
    }

    private func unavailableReply() -> MacAccessXPCReply {
        MacAccessXPCReply(
            code: .configurationUnavailable,
            status: MacAccessXPCSafeStatus(
                pairing: "unpaired", transport: "blocked",
                lastErrorCode: "configuration_unavailable", lastAuditID: nil
            )
        )
    }

    private func reply(
        code: MacAccessXPCReplyCode,
        status: MacAccessHelperSafeStatus = .initial,
        permissions: MacAccessPermissionStatus = .unknown,
        accessMode: MacAccessMode = .off
    ) -> MacAccessXPCReply {
        MacAccessXPCReply(
            code: code,
            status: MacAccessXPCSafeStatus(
                pairing: status.pairing.rawValue,
                transport: status.transport.rawValue,
                lastErrorCode: status.lastError?.rawValue,
                lastAuditID: status.lastAuditID,
                permissions: permissions,
                accessMode: accessMode
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

    func setAccessMode(_ mode: String, withReply reply: @escaping @Sendable (Data) -> Void) {
        guard let mode = MacAccessMode(rawValue: mode) else {
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
        respond(reply) { await self.core.setAccessMode(mode) }
    }

    func requestAccessibility(withReply reply: @escaping @Sendable (Data) -> Void) {
        respond(reply) { await self.core.requestPermission(.accessibility) }
    }

    func requestScreenRecording(withReply reply: @escaping @Sendable (Data) -> Void) {
        respond(reply) { await self.core.requestPermission(.screenRecording) }
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
    private let approvalBroker: MacAccessApprovalBroker

    override init() {
        let approvalBroker = MacAccessApprovalBroker()
        self.approvalBroker = approvalBroker
        service = MacAccessXPCService(core: MacAccessRuntimeXPCServiceCore(
            configuration: MacAccessHelperDeploymentConfiguration.load(),
            approvalRequester: approvalBroker
        ))
        super.init()
    }

    init(core: any MacAccessXPCServiceCore) {
        approvalBroker = MacAccessApprovalBroker()
        service = MacAccessXPCService(core: core)
        super.init()
    }

    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        connection.setCodeSigningRequirement(MacAccessXPCCallerPolicy.combinedRequirement)
        connection.exportedInterface = NSXPCInterface(with: MacAccessXPCServiceProtocol.self)
        connection.exportedObject = service
        connection.remoteObjectInterface = NSXPCInterface(with: MacAccessXPCApprovalProtocol.self)
        if let remote = connection.remoteObjectProxyWithErrorHandler({ _ in })
            as? MacAccessXPCApprovalProtocol
        {
            let provider = MacAccessXPCApprovalProxy(proxy: remote)
            let broker = approvalBroker
            Task { await broker.install(provider) }
            connection.invalidationHandler = {
                Task { await broker.clear(providerID: provider.id) }
            }
            connection.interruptionHandler = {
                Task { await broker.clear(providerID: provider.id) }
            }
        }
        connection.resume()
        return true
    }
}
