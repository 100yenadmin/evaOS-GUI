import Foundation

public enum ConnectorCoreAction: Equatable, Sendable {
    case pair(String)
    case unpair
    case connect
    case disconnect
    case setAccessMode(MacAccessMode)
    case pause
    case resume
    case revokeSelectedVM
    case stop
    case activateKillSwitch
}

public enum ConnectorCoreCompletion: Equatable, Sendable {
    case paired
    case unpaired
    case connected
    case disconnected
    case revoked
    case localStop
    case localPause
    case localResume
    case localEmergencyStop
    case accessModeChanged(MacAccessMode)
}

public enum ConnectorCoreInvalidationReason: Equatable, Sendable {
    case quitCleanup
    case localPrecondition(MacAccessBlocker)
}

public enum ConnectorCoreResult: Equatable, Sendable {
    case completed(ConnectorCoreCompletion)
    case blocked(MacAccessBlocker)
}

public enum MacAccessActionResult: Equatable, Sendable {
    case completed(ConnectorCoreCompletion)
    case blocked(MacAccessBlocker)
    case invalidated(ConnectorCoreInvalidationReason)
}

public protocol ConnectorCoreClient: Sendable {
    func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult
}

public struct LocalOnlyConnectorCoreClient: ConnectorCoreClient {
    public init() {}

    public func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        switch action {
        case .pair, .unpair:
            return .blocked(.dashboardPairingUnavailable)
        case .connect, .disconnect, .revokeSelectedVM:
            return .blocked(.relayUnavailable)
        case .setAccessMode(let mode):
            return mode == .off ? .completed(.localStop) : .blocked(.connectorCoreUnavailable)
        case .pause:
            return .completed(.localPause)
        case .resume:
            return .completed(.localResume)
        case .stop:
            return .completed(.localStop)
        case .activateKillSwitch:
            return .completed(.localEmergencyStop)
        }
    }
}

public struct MacAccessActionAvailability: Equatable, Sendable {
    public let pairing: Bool
    public let transport: Bool
    public let elevatedAccessModes: Bool
    public let revoke: Bool
    public let update: Bool

    public static let localOnly = MacAccessActionAvailability(
        pairing: false,
        transport: false,
        elevatedAccessModes: false,
        revoke: false,
        update: false
    )

    public static let pairingTransport = MacAccessActionAvailability(
        pairing: true,
        transport: true,
        elevatedAccessModes: false,
        revoke: true,
        update: false
    )
}
