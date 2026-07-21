import Foundation

public enum MacAccessConnectionState: String, CaseIterable, Sendable {
    case disconnected
    case connecting
    case connected
    case paused
    case blocked
}

public enum MacAccessMode: String, CaseIterable, Codable, Sendable {
    case off
    case fullAccess
}

public enum MacAccessBlocker: String, Equatable, Sendable {
    case notPaired
    case invalidPairingCode
    case pairingRejected
    case credentialUnavailable
    case policyUnavailable
    case dashboardPairingUnavailable
    case relayUnavailable
    case connectorCoreUnavailable
    case emergencyStopActive
    case permissionProofPending
    case permissionDenied
    case stalePairing
    case revokedGrant
    case offlineBroker
    case coreCrashed
    case updateRequired
    case conflictingWorkbenchOwner
}

public struct MacAccessState: Equatable, Sendable {
    public var connection: MacAccessConnectionState
    public var configuredMode: MacAccessMode
    public var effectiveMode: MacAccessMode
    public var isPaired: Bool
    public var blocker: MacAccessBlocker?
    public var lastActivityAt: Date?
    public var emergencyStopCount: Int
    public var quitCleanupRequested: Bool

    public init(
        connection: MacAccessConnectionState,
        configuredMode: MacAccessMode,
        effectiveMode: MacAccessMode,
        isPaired: Bool,
        blocker: MacAccessBlocker?,
        lastActivityAt: Date? = nil,
        emergencyStopCount: Int = 0,
        quitCleanupRequested: Bool = false
    ) {
        self.connection = connection
        self.configuredMode = configuredMode
        self.effectiveMode = effectiveMode
        self.isPaired = isPaired
        self.blocker = blocker
        self.lastActivityAt = lastActivityAt
        self.emergencyStopCount = emergencyStopCount
        self.quitCleanupRequested = quitCleanupRequested
    }

    public static let safeInitial = MacAccessState(
        connection: .blocked,
        configuredMode: .off,
        effectiveMode: .off,
        isPaired: false,
        blocker: .dashboardPairingUnavailable
    )
}

public struct MacAccessStateMachine: Sendable {
    public private(set) var state: MacAccessState

    public init(state: MacAccessState = .safeInitial) {
        self.state = state
    }

    public mutating func beginConnecting() {
        guard state.blocker == nil else {
            state.connection = .blocked
            state.effectiveMode = .off
            return
        }
        guard state.isPaired else {
            block(.notPaired)
            return
        }
        state.connection = .connecting
        state.effectiveMode = .off
        state.blocker = nil
    }

    public mutating func markPaired() {
        state.isPaired = true
        state.connection = .disconnected
        state.effectiveMode = .off
        state.blocker = nil
    }

    public mutating func markUnpaired(_ blocker: MacAccessBlocker = .notPaired) {
        state.isPaired = false
        state.configuredMode = .off
        state.effectiveMode = .off
        state.connection = .blocked
        state.blocker = blocker
    }

    public mutating func markConnected(at date: Date) {
        guard state.blocker == nil else {
            state.connection = .blocked
            state.effectiveMode = .off
            return
        }
        guard state.isPaired else {
            block(.notPaired)
            return
        }
        guard state.connection == .connecting else {
            block(.connectorCoreUnavailable)
            return
        }
        state.connection = .connected
        state.effectiveMode = state.configuredMode
        state.blocker = nil
        state.lastActivityAt = date
    }

    public mutating func prepareForRelayReconnect() {
        guard state.isPaired,
              state.connection == .blocked,
              state.blocker == .relayUnavailable
        else { return }
        state.connection = .disconnected
        state.effectiveMode = .off
        state.blocker = nil
    }

    public mutating func disconnect() {
        guard state.blocker == nil else {
            state.connection = .blocked
            state.effectiveMode = .off
            return
        }
        state.connection = .disconnected
        state.effectiveMode = .off
        state.blocker = nil
    }

    public mutating func pause() {
        guard state.blocker == nil else {
            state.connection = .blocked
            state.effectiveMode = .off
            return
        }
        guard state.isPaired else {
            block(.notPaired)
            return
        }
        guard state.connection == .connected else {
            block(.connectorCoreUnavailable)
            return
        }
        state.connection = .paused
        state.effectiveMode = .off
        state.blocker = nil
    }

    public mutating func resume() {
        guard state.blocker == nil else {
            state.connection = .blocked
            state.effectiveMode = .off
            return
        }
        guard state.isPaired else {
            block(.notPaired)
            return
        }
        guard state.connection == .paused else {
            block(.connectorCoreUnavailable)
            return
        }
        state.effectiveMode = .off
        state.connection = .disconnected
        state.blocker = nil
    }

    public mutating func selectOff() {
        state.configuredMode = .off
        state.effectiveMode = .off
    }

    public mutating func selectMode(_ mode: MacAccessMode) {
        state.configuredMode = mode
        state.effectiveMode = state.connection == .connected ? mode : .off
    }

    public mutating func stop() {
        state.configuredMode = .off
        state.effectiveMode = .off
        state.connection = state.isPaired && state.blocker == nil ? .disconnected : .blocked
    }

    public mutating func block(_ blocker: MacAccessBlocker) {
        state.connection = .blocked
        state.effectiveMode = .off
        state.blocker = blocker
    }

    public mutating func emergencyStop() {
        state.configuredMode = .off
        state.effectiveMode = .off
        state.connection = .blocked
        state.blocker = .emergencyStopActive
        if state.emergencyStopCount == 0 {
            state.emergencyStopCount = 1
        }
    }

    public mutating func requestQuitCleanup() {
        state.quitCleanupRequested = true
        state.configuredMode = .off
        state.effectiveMode = .off
    }

    public mutating func restoreAfterRestart() {
        state.configuredMode = .off
        state.effectiveMode = .off
        state.connection = state.isPaired ? .disconnected : .blocked
        state.blocker = state.isPaired ? nil : .dashboardPairingUnavailable
        state.quitCleanupRequested = false
    }
}
