import Foundation

public enum MacAccessXPCAction: String, Codable, Equatable, Sendable {
    case status, pair, connect, disconnect, stop, revoke
}

public enum MacAccessXPCPolicyOperation: String, Codable, Equatable, Sendable {
    case setAccessMode = "set_access_mode"
    case pause, resume
    case activateKillSwitch = "activate_kill_switch"
    case approveAction = "approve_action"
    case auditSummary = "audit_summary"
}

public struct MacAccessXPCApproval: Codable, Equatable, Sendable {
    public let commandID: String
    public let capability: String
    public let requestDigestSHA256: String
    public let bindingFingerprintSHA256: String
    public let policyEpoch: Int64
    public let ttlSeconds: Int

    public init(
        commandID: String, capability: String, requestDigestSHA256: String,
        bindingFingerprintSHA256: String, policyEpoch: Int64, ttlSeconds: Int
    ) {
        self.commandID = commandID
        self.capability = capability
        self.requestDigestSHA256 = requestDigestSHA256
        self.bindingFingerprintSHA256 = bindingFingerprintSHA256
        self.policyEpoch = policyEpoch
        self.ttlSeconds = ttlSeconds
    }
}

public struct MacAccessXPCPolicyRequest: Codable, Equatable, Sendable {
    public let operation: MacAccessXPCPolicyOperation
    public let mode: String?
    public let approval: MacAccessXPCApproval?
    public let auditAfterSequence: Int64?
    public let auditAfterDigestSHA256: String?
    public let auditLimit: Int?

    public init(
        operation: MacAccessXPCPolicyOperation, mode: String? = nil,
        approval: MacAccessXPCApproval? = nil, auditAfterSequence: Int64? = nil,
        auditAfterDigestSHA256: String? = nil, auditLimit: Int? = nil
    ) {
        self.operation = operation
        self.mode = mode
        self.approval = approval
        self.auditAfterSequence = auditAfterSequence
        self.auditAfterDigestSHA256 = auditAfterDigestSHA256
        self.auditLimit = auditLimit
    }
}

public enum MacAccessXPCReplyCode: String, Codable, Equatable, Sendable {
    case ok
    case invalidRequest = "invalid_request"
    case invalidPairingCode = "invalid_pairing_code"
    case pairingRejected = "pairing_rejected"
    case credentialUnavailable = "credential_unavailable"
    case configurationUnavailable = "configuration_unavailable"
    case relayUnavailable = "relay_unavailable"
    case commandRejected = "command_rejected"
    case policyUnavailable = "policy_unavailable"
    case revoked
    case stopped
}

public struct MacAccessXPCSafeStatus: Codable, Equatable, Sendable {
    public let pairing: String
    public let transport: String
    public let lastErrorCode: String?
    public let lastAuditID: String?
    public let configuredMode: String?
    public let effectiveMode: String?
    public let paused: Bool?
    public let killSwitch: Bool?
    public let policyEpoch: Int64?
    public let policyProvider: String?
    public let auditEventCount: Int?

    public init(
        pairing: String, transport: String, lastErrorCode: String?, lastAuditID: String?,
        configuredMode: String? = nil, effectiveMode: String? = nil,
        paused: Bool? = nil, killSwitch: Bool? = nil, policyEpoch: Int64? = nil,
        policyProvider: String? = nil, auditEventCount: Int? = nil
    ) {
        self.pairing = pairing
        self.transport = transport
        self.lastErrorCode = lastErrorCode
        self.lastAuditID = lastAuditID
        self.configuredMode = configuredMode
        self.effectiveMode = effectiveMode
        self.paused = paused
        self.killSwitch = killSwitch
        self.policyEpoch = policyEpoch
        self.policyProvider = policyProvider
        self.auditEventCount = auditEventCount
    }
}

public struct MacAccessXPCReply: Codable, Equatable, Sendable {
    public let code: MacAccessXPCReplyCode
    public let status: MacAccessXPCSafeStatus

    public init(code: MacAccessXPCReplyCode, status: MacAccessXPCSafeStatus) {
        self.code = code
        self.status = status
    }
}

@objc public protocol MacAccessXPCServiceProtocol {
    func status(withReply reply: @escaping @Sendable (Data) -> Void)
    func pair(code: String, withReply reply: @escaping @Sendable (Data) -> Void)
    func connect(withReply reply: @escaping @Sendable (Data) -> Void)
    func disconnect(withReply reply: @escaping @Sendable (Data) -> Void)
    func stop(withReply reply: @escaping @Sendable (Data) -> Void)
    func revoke(withReply reply: @escaping @Sendable (Data) -> Void)
    func policy(request: Data, withReply reply: @escaping @Sendable (Data) -> Void)
}

protocol MacAccessXPCTransport: Sendable {
    func request(_ action: MacAccessXPCAction, code: String?) async throws -> Data
    func policy(_ request: MacAccessXPCPolicyRequest) async throws -> Data
}

extension MacAccessXPCTransport {
    func policy(_ request: MacAccessXPCPolicyRequest) async throws -> Data {
        throw CocoaError(.featureUnsupported)
    }
}

private final class MacAccessXPCReplyGate: @unchecked Sendable {
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

actor ProductionMacAccessXPCTransport: MacAccessXPCTransport {
    static let maximumReplyBytes = 4 << 10
    private var connection: NSXPCConnection?

    func request(_ action: MacAccessXPCAction, code: String?) async throws -> Data {
        let connection = connection ?? makeConnection()
        self.connection = connection
        return try await withCheckedThrowingContinuation { continuation in
            let gate = MacAccessXPCReplyGate()
            let proxy = connection.remoteObjectProxyWithErrorHandler { error in
                gate.resolve { continuation.resume(throwing: error) }
            }
            guard let service = proxy as? MacAccessXPCServiceProtocol else {
                gate.resolve { continuation.resume(throwing: CocoaError(.xpcConnectionInvalid)) }
                return
            }
            let receive: @Sendable (Data) -> Void = { data in
                gate.resolve {
                    if data.count <= Self.maximumReplyBytes {
                        continuation.resume(returning: data)
                    } else {
                        continuation.resume(throwing: CocoaError(.coderReadCorrupt))
                    }
                }
            }
            switch action {
            case .status: service.status(withReply: receive)
            case .pair: service.pair(code: code ?? "", withReply: receive)
            case .connect: service.connect(withReply: receive)
            case .disconnect: service.disconnect(withReply: receive)
            case .stop: service.stop(withReply: receive)
            case .revoke: service.revoke(withReply: receive)
            }
        }
    }

    func policy(_ request: MacAccessXPCPolicyRequest) async throws -> Data {
        let connection = connection ?? makeConnection()
        self.connection = connection
        let requestData = try JSONEncoder().encode(request)
        guard requestData.count <= Self.maximumReplyBytes else {
            throw CocoaError(.coderValueNotFound)
        }
        return try await withCheckedThrowingContinuation { continuation in
            let gate = MacAccessXPCReplyGate()
            let proxy = connection.remoteObjectProxyWithErrorHandler { error in
                gate.resolve { continuation.resume(throwing: error) }
            }
            guard let service = proxy as? MacAccessXPCServiceProtocol else {
                gate.resolve { continuation.resume(throwing: CocoaError(.xpcConnectionInvalid)) }
                return
            }
            service.policy(request: requestData) { data in
                gate.resolve {
                    if data.count <= Self.maximumReplyBytes {
                        continuation.resume(returning: data)
                    } else {
                        continuation.resume(throwing: CocoaError(.coderReadCorrupt))
                    }
                }
            }
        }
    }

    private func makeConnection() -> NSXPCConnection {
        let connection = NSXPCConnection(serviceName: MacAccessIdentity.helperServiceID)
        connection.remoteObjectInterface = NSXPCInterface(with: MacAccessXPCServiceProtocol.self)
        connection.setCodeSigningRequirement(MacAccessIdentity.helperDesignatedRequirement)
        connection.invalidationHandler = { [self] in
            Task { await clearConnection() }
        }
        connection.interruptionHandler = { [self] in
            Task { await clearConnection() }
        }
        connection.resume()
        return connection
    }

    private func clearConnection() {
        connection?.invalidationHandler = nil
        connection?.interruptionHandler = nil
        connection = nil
    }
}

public actor MacAccessXPCConnectorCoreClient: ConnectorCoreClient {
    private let transport: any MacAccessXPCTransport

    public init() {
        transport = ProductionMacAccessXPCTransport()
    }

    init(transport: any MacAccessXPCTransport) {
        self.transport = transport
    }

    public func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        let request: (MacAccessXPCAction, String?)?
        let policy: MacAccessXPCPolicyRequest?
        switch action {
        case .pair(let code): request = (.pair, code); policy = nil
        case .unpair, .revokeSelectedVM: request = (.revoke, nil); policy = nil
        case .connect: request = (.connect, nil); policy = nil
        case .disconnect: request = (.disconnect, nil); policy = nil
        case .stop: request = (.stop, nil); policy = nil
        case .setAccessMode(let mode):
            request = nil
            policy = MacAccessXPCPolicyRequest(operation: .setAccessMode, mode: mode.coreValue)
        case .pause: request = nil; policy = MacAccessXPCPolicyRequest(operation: .pause)
        case .resume: request = nil; policy = MacAccessXPCPolicyRequest(operation: .resume)
        case .activateKillSwitch:
            request = nil
            policy = MacAccessXPCPolicyRequest(operation: .activateKillSwitch)
        }
        do {
            let data: Data
            if let request {
                data = try await transport.request(request.0, code: request.1)
            } else if let policy {
                data = try await transport.policy(policy)
            } else {
                return .blocked(.connectorCoreUnavailable)
            }
            guard data.count <= ProductionMacAccessXPCTransport.maximumReplyBytes else {
                return .blocked(.connectorCoreUnavailable)
            }
            let reply = try JSONDecoder().decode(MacAccessXPCReply.self, from: data)
            return map(reply.code, for: action)
        } catch {
            return .blocked(action.isPairing ? .dashboardPairingUnavailable : .relayUnavailable)
        }
    }

    public func fetchStatus() async -> MacAccessXPCReply? {
        guard let data = try? await transport.request(.status, code: nil),
              data.count <= ProductionMacAccessXPCTransport.maximumReplyBytes
        else { return nil }
        return try? JSONDecoder().decode(MacAccessXPCReply.self, from: data)
    }

    private func map(_ code: MacAccessXPCReplyCode, for action: ConnectorCoreAction) -> ConnectorCoreResult {
        switch code {
        case .ok:
            switch action {
            case .pair: return .completed(.paired)
            case .unpair: return .completed(.unpaired)
            case .connect: return .completed(.connected)
            case .disconnect: return .completed(.disconnected)
            case .revokeSelectedVM: return .completed(.revoked)
            case .stop, .setAccessMode(.off): return .completed(.localStop)
            case .pause: return .completed(.localPause)
            case .resume: return .completed(.localResume)
            case .activateKillSwitch: return .completed(.localEmergencyStop)
            case .setAccessMode(let mode): return .completed(.accessModeChanged(mode))
            }
        case .invalidPairingCode: return .blocked(.invalidPairingCode)
        case .pairingRejected: return .blocked(.pairingRejected)
        case .credentialUnavailable: return .blocked(.credentialUnavailable)
        case .policyUnavailable: return .blocked(.policyUnavailable)
        case .configurationUnavailable:
            return .blocked(action.isPairing ? .dashboardPairingUnavailable : .relayUnavailable)
        case .revoked: return .blocked(.revokedGrant)
        case .stopped: return .completed(.localStop)
        case .invalidRequest, .commandRejected: return .blocked(.connectorCoreUnavailable)
        case .relayUnavailable: return .blocked(.relayUnavailable)
        }
    }
}

private extension MacAccessMode {
    var coreValue: String {
        switch self {
        case .off: "off"
        case .askEveryTime: "ask_every_time"
        case .fullAccess: "full_access"
        }
    }
}

private extension ConnectorCoreAction {
    var isPairing: Bool {
        if case .pair = self { return true }
        return false
    }
}
