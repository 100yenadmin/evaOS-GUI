import Foundation

public enum MacAccessXPCAction: String, Codable, Equatable, Sendable {
    case status, pair, connect, disconnect, stop, revoke
    case requestAccessibility = "request_accessibility"
    case requestScreenRecording = "request_screen_recording"
}

public enum MacAccessPermissionKind: String, Codable, Equatable, Sendable {
    case accessibility
    case screenRecording = "screen_recording"
}

public enum MacAccessPermissionState: String, Codable, Equatable, Sendable {
    case granted, denied, unknown
}

public struct MacAccessPermissionStatus: Codable, Equatable, Sendable {
    public let accessibility: MacAccessPermissionState
    public let screenRecording: MacAccessPermissionState

    public static let unknown = MacAccessPermissionStatus(
        accessibility: .unknown,
        screenRecording: .unknown
    )

    public init(
        accessibility: MacAccessPermissionState,
        screenRecording: MacAccessPermissionState
    ) {
        self.accessibility = accessibility
        self.screenRecording = screenRecording
    }

    enum CodingKeys: String, CodingKey {
        case accessibility
        case screenRecording = "screen_recording"
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
    public let permissions: MacAccessPermissionStatus

    public init(
        pairing: String,
        transport: String,
        lastErrorCode: String?,
        lastAuditID: String?,
        permissions: MacAccessPermissionStatus = .unknown
    ) {
        self.pairing = pairing
        self.transport = transport
        self.lastErrorCode = lastErrorCode
        self.lastAuditID = lastAuditID
        self.permissions = permissions
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

public protocol MacAccessStatusProvidingClient: ConnectorCoreClient {
    func fetchStatus() async -> MacAccessXPCReply?
}

public protocol MacAccessPermissionControllingClient: MacAccessStatusProvidingClient {
    func requestPermission(_ kind: MacAccessPermissionKind) async -> MacAccessXPCReply?
}

@objc public protocol MacAccessXPCServiceProtocol {
    func status(withReply reply: @escaping @Sendable (Data) -> Void)
    func pair(code: String, withReply reply: @escaping @Sendable (Data) -> Void)
    func connect(withReply reply: @escaping @Sendable (Data) -> Void)
    func disconnect(withReply reply: @escaping @Sendable (Data) -> Void)
    func stop(withReply reply: @escaping @Sendable (Data) -> Void)
    func revoke(withReply reply: @escaping @Sendable (Data) -> Void)
    func requestAccessibility(withReply reply: @escaping @Sendable (Data) -> Void)
    func requestScreenRecording(withReply reply: @escaping @Sendable (Data) -> Void)
}

protocol MacAccessXPCTransport: Sendable {
    func request(_ action: MacAccessXPCAction, code: String?) async throws -> Data
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
            case .requestAccessibility: service.requestAccessibility(withReply: receive)
            case .requestScreenRecording: service.requestScreenRecording(withReply: receive)
            }
        }
    }

    private func makeConnection() -> NSXPCConnection {
        let connection = NSXPCConnection(serviceName: MacAccessIdentity.helperServiceID)
        connection.remoteObjectInterface = NSXPCInterface(with: MacAccessXPCServiceProtocol.self)
        connection.setCodeSigningRequirement(MacAccessIdentity.helperDesignatedRequirement)
        connection.invalidationHandler = { [weak self] in
            Task { await self?.clearConnection() }
        }
        connection.interruptionHandler = { [weak self] in
            Task { await self?.clearConnection() }
        }
        connection.resume()
        return connection
    }

    private func clearConnection() {
        connection = nil
    }
}

public actor MacAccessXPCConnectorCoreClient: MacAccessPermissionControllingClient {
    private let transport: any MacAccessXPCTransport

    public init() {
        transport = ProductionMacAccessXPCTransport()
    }

    init(transport: any MacAccessXPCTransport) {
        self.transport = transport
    }

    public func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        let request: (MacAccessXPCAction, String?)
        switch action {
        case .pair(let code): request = (.pair, code)
        case .unpair, .revokeSelectedVM: request = (.revoke, nil)
        case .connect: request = (.connect, nil)
        case .disconnect: request = (.disconnect, nil)
        case .stop, .setAccessMode(.off): request = (.stop, nil)
        case .setAccessMode, .pause, .resume:
            return .blocked(.connectorCoreUnavailable)
        }
        do {
            let data = try await transport.request(request.0, code: request.1)
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

    public func requestPermission(_ kind: MacAccessPermissionKind) async -> MacAccessXPCReply? {
        let action: MacAccessXPCAction = switch kind {
        case .accessibility: .requestAccessibility
        case .screenRecording: .requestScreenRecording
        }
        guard let data = try? await transport.request(action, code: nil),
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
            case .setAccessMode: return .blocked(.connectorCoreUnavailable)
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

private extension ConnectorCoreAction {
    var isPairing: Bool {
        if case .pair = self { return true }
        return false
    }
}
