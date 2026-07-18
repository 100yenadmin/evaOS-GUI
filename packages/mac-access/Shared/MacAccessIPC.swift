import ApplicationServices
import CoreGraphics
import Foundation

public enum MacAccessXPCAction: String, Codable, Equatable, Sendable {
    case status, pair, connect, disconnect, stop, revoke
    case setAccessMode = "set_access_mode"
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
    case permissionDenied = "permission_denied"
    case revoked
    case stopped
}

public struct MacAccessXPCSafeStatus: Codable, Equatable, Sendable {
    public let pairing: String
    public let transport: String
    public let lastErrorCode: String?
    public let lastAuditID: String?
    public let permissions: MacAccessPermissionStatus
    public let accessMode: MacAccessMode

    public init(
        pairing: String,
        transport: String,
        lastErrorCode: String?,
        lastAuditID: String?,
        permissions: MacAccessPermissionStatus = .unknown,
        accessMode: MacAccessMode = .off
    ) {
        self.pairing = pairing
        self.transport = transport
        self.lastErrorCode = lastErrorCode
        self.lastAuditID = lastAuditID
        self.permissions = permissions
        self.accessMode = accessMode
    }
}

public struct MacAccessApprovalRequest: Codable, Equatable, Sendable {
    public let requestID: String
    public let capability: String
    public let actionSummary: String
    public let requestDigestSHA256: String

    public init(
        requestID: String,
        capability: String,
        actionSummary: String,
        requestDigestSHA256: String
    ) {
        self.requestID = requestID
        self.capability = capability
        self.actionSummary = actionSummary
        self.requestDigestSHA256 = requestDigestSHA256
    }
}

public struct MacAccessApprovalReply: Codable, Equatable, Sendable {
    public let requestID: String
    public let approved: Bool

    public init(requestID: String, approved: Bool) {
        self.requestID = requestID
        self.approved = approved
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

public struct SystemMacAccessPermissionAuthorizer: Sendable {
    public init() {}

    public func currentStatus() async -> MacAccessPermissionStatus {
        await MainActor.run {
            MacAccessPermissionStatus(
                accessibility: AXIsProcessTrusted() ? .granted : .denied,
                screenRecording: CGPreflightScreenCaptureAccess() ? .granted : .denied
            )
        }
    }

    public func request(_ kind: MacAccessPermissionKind) async -> MacAccessPermissionStatus {
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

@objc public protocol MacAccessXPCServiceProtocol {
    func status(withReply reply: @escaping @Sendable (Data) -> Void)
    func pair(code: String, withReply reply: @escaping @Sendable (Data) -> Void)
    func connect(withReply reply: @escaping @Sendable (Data) -> Void)
    func disconnect(withReply reply: @escaping @Sendable (Data) -> Void)
    func stop(withReply reply: @escaping @Sendable (Data) -> Void)
    func revoke(withReply reply: @escaping @Sendable (Data) -> Void)
    func setAccessMode(_ mode: String, withReply reply: @escaping @Sendable (Data) -> Void)
    func requestAccessibility(withReply reply: @escaping @Sendable (Data) -> Void)
    func requestScreenRecording(withReply reply: @escaping @Sendable (Data) -> Void)
}

@objc public protocol MacAccessXPCApprovalProtocol: Sendable {
    func requestApproval(_ request: Data, withReply reply: @escaping @Sendable (Data) -> Void)
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
    private let approvalHandler: (any MacAccessXPCApprovalProtocol)?

    init(approvalHandler: (any MacAccessXPCApprovalProtocol)? = nil) {
        self.approvalHandler = approvalHandler
    }

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
            case .setAccessMode: service.setAccessMode(code ?? "", withReply: receive)
            case .requestAccessibility: service.requestAccessibility(withReply: receive)
            case .requestScreenRecording: service.requestScreenRecording(withReply: receive)
            }
        }
    }

    private func makeConnection() -> NSXPCConnection {
        let connection = NSXPCConnection(serviceName: MacAccessIdentity.helperServiceID)
        connection.remoteObjectInterface = NSXPCInterface(with: MacAccessXPCServiceProtocol.self)
        if let approvalHandler {
            connection.exportedInterface = NSXPCInterface(with: MacAccessXPCApprovalProtocol.self)
            connection.exportedObject = approvalHandler
        }
        connection.setCodeSigningRequirement(MacAccessIdentity.helperDesignatedRequirement)
        let owner = self
        connection.invalidationHandler = {
            Task { await owner.clearConnection() }
        }
        connection.interruptionHandler = {
            Task { await owner.clearConnection() }
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

    public init(approvalHandler: (any MacAccessXPCApprovalProtocol)? = nil) {
        transport = ProductionMacAccessXPCTransport(approvalHandler: approvalHandler)
    }

    init(transport: any MacAccessXPCTransport) {
        self.transport = transport
    }

    public func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        if case .setAccessMode(let mode) = action, mode != .off {
            let permissions = await SystemMacAccessPermissionAuthorizer().currentStatus()
            guard permissions.accessibility == .granted,
                  permissions.screenRecording == .granted
            else { return .blocked(.permissionDenied) }
        }
        let request: (MacAccessXPCAction, String?)
        switch action {
        case .pair(let code): request = (.pair, code)
        case .unpair, .revokeSelectedVM: request = (.revoke, nil)
        case .connect: request = (.connect, nil)
        case .disconnect: request = (.disconnect, nil)
        case .stop: request = (.stop, nil)
        case .setAccessMode(let mode): request = (.setAccessMode, mode.rawValue)
        case .pause, .resume:
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
        guard let reply = await fetchRawStatus() else { return nil }
        let permissions = await SystemMacAccessPermissionAuthorizer().currentStatus()
        return replacingPermissions(in: reply, with: permissions)
    }

    private func fetchRawStatus() async -> MacAccessXPCReply? {
        guard let data = try? await transport.request(.status, code: nil),
              data.count <= ProductionMacAccessXPCTransport.maximumReplyBytes
        else { return nil }
        return try? JSONDecoder().decode(MacAccessXPCReply.self, from: data)
    }

    public func requestPermission(_ kind: MacAccessPermissionKind) async -> MacAccessXPCReply? {
        let permissions = await SystemMacAccessPermissionAuthorizer().request(kind)
        guard let reply = await fetchRawStatus() else { return nil }
        return replacingPermissions(in: reply, with: permissions)
    }

    private func replacingPermissions(
        in reply: MacAccessXPCReply,
        with permissions: MacAccessPermissionStatus
    ) -> MacAccessXPCReply {
        MacAccessXPCReply(
            code: reply.code,
            status: MacAccessXPCSafeStatus(
                pairing: reply.status.pairing,
                transport: reply.status.transport,
                lastErrorCode: reply.status.lastErrorCode,
                lastAuditID: reply.status.lastAuditID,
                permissions: permissions,
                accessMode: reply.status.accessMode
            )
        )
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
            case .stop: return .completed(.localStop)
            case .pause: return .completed(.localPause)
            case .resume: return .completed(.localResume)
            case .setAccessMode(let mode): return .completed(.accessModeSet(mode))
            }
        case .invalidPairingCode: return .blocked(.invalidPairingCode)
        case .pairingRejected: return .blocked(.pairingRejected)
        case .credentialUnavailable: return .blocked(.credentialUnavailable)
        case .policyUnavailable: return .blocked(.policyUnavailable)
        case .permissionDenied: return .blocked(.permissionDenied)
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
