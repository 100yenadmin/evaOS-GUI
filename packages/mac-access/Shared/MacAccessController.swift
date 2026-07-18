import Combine
import Foundation

@MainActor
public final class MacAccessController: ObservableObject {
    @Published public private(set) var state: MacAccessState
    @Published public private(set) var lastResult: MacAccessActionResult?
    @Published public private(set) var permissions: MacAccessPermissionStatus = .unknown

    public let availability: MacAccessActionAvailability
    private let client: any ConnectorCoreClient
    private var machine: MacAccessStateMachine
    private var actionGeneration = 0
    private var inFlightCounts: [Int: Int] = [:]
    private var invalidationReasons: [Int: ActionInvalidationReason] = [:]
    private var quitCleanupInFlight = false
    private var emergencyStopCleanupIssued = false

    private enum ActionInvalidationReason {
        case emergencyStop
        case quitCleanup
        case localPrecondition(MacAccessBlocker)
    }

    public init(
        client: any ConnectorCoreClient = LocalOnlyConnectorCoreClient(),
        initialState: MacAccessState = .safeInitial,
        availability: MacAccessActionAvailability = .localOnly
    ) {
        self.client = client
        self.machine = MacAccessStateMachine(state: initialState)
        self.state = initialState
        self.availability = availability
    }

    public var canConnect: Bool {
        availability.transport && state.isPaired && state.connection == .disconnected
    }

    public func refreshFromHelper() async {
        guard !state.quitCleanupRequested, state.blocker != .emergencyStopActive,
              let client = client as? any MacAccessStatusProvidingClient,
              let reply = await client.fetchStatus()
        else { return }

        let paired = reply.status.pairing == "paired"
        permissions = reply.status.permissions
        let connection: MacAccessConnectionState
        switch reply.status.transport {
        case "connecting":
            connection = .connecting
        case "connected":
            connection = .connected
        case "disconnected":
            connection = paired ? .disconnected : .blocked
        default:
            connection = .blocked
        }
        let blocker = Self.blocker(
            pairing: reply.status.pairing,
            transport: reply.status.transport,
            errorCode: reply.status.lastErrorCode
        )
        let projected = MacAccessState(
            connection: blocker == nil ? connection : .blocked,
            configuredMode: state.configuredMode,
            effectiveMode: connection == .connected ? state.effectiveMode : .off,
            isPaired: paired,
            blocker: blocker,
            lastActivityAt: state.lastActivityAt,
            emergencyStopCount: state.emergencyStopCount,
            quitCleanupRequested: state.quitCleanupRequested
        )
        machine = MacAccessStateMachine(state: projected)
        state = projected
    }

    public var canUseElevatedAccessModes: Bool {
        availability.elevatedAccessModes
            && permissions.accessibility == .granted
            && permissions.screenRecording == .granted
    }

    public func requestPermission(_ kind: MacAccessPermissionKind) async {
        guard let client = client as? any MacAccessPermissionControllingClient,
              let reply = await client.requestPermission(kind)
        else { return }
        permissions = reply.status.permissions
    }

    @discardableResult
    public func perform(_ action: ConnectorCoreAction) async -> MacAccessActionResult {
        await perform(action, ownsQuitCleanup: false)
    }

    private func perform(
        _ action: ConnectorCoreAction,
        ownsQuitCleanup: Bool
    ) async -> MacAccessActionResult {
        if state.quitCleanupRequested, !ownsQuitCleanup {
            return .invalidated(.quitCleanup)
        }
        if let blocker = localPreconditionBlocker(for: action) {
            invalidateCurrentGeneration(because: .localPrecondition(blocker))
            return apply(.blocked(blocker), for: action)
        }
        if inFlightCounts[actionGeneration, default: 0] > 0 {
            let blocker = state.blocker ?? .connectorCoreUnavailable
            invalidateCurrentGeneration(because: .localPrecondition(blocker))
            return apply(.blocked(blocker), for: action)
        }

        let generation = actionGeneration
        inFlightCounts[generation, default: 0] += 1
        let result = await client.perform(action)
        defer { finishAction(in: generation) }
        guard generation == actionGeneration else {
            return invalidatedResult(for: generation)
        }
        let applied = apply(result, for: action)
        await refreshFromHelper()
        return applied
    }

    public func emergencyStop() {
        invalidateCurrentGeneration(because: .emergencyStop)
        machine.emergencyStop()
        state = machine.state
        lastResult = .completed(.localEmergencyStop)
        guard !emergencyStopCleanupIssued else { return }
        emergencyStopCleanupIssued = true
        Task { await requestEmergencyStopCleanup() }
    }

    @discardableResult
    public func prepareToQuit() async -> MacAccessActionResult {
        guard !quitCleanupInFlight else {
            return .invalidated(.quitCleanup)
        }
        invalidateCurrentGeneration(because: .quitCleanup)
        machine.requestQuitCleanup()
        state = machine.state
        quitCleanupInFlight = true
        defer { quitCleanupInFlight = false }
        return await perform(.stop, ownsQuitCleanup: true)
    }

    public func restoreAfterRestart() {
        machine.restoreAfterRestart()
        state = machine.state
    }

    @discardableResult
    private func apply(_ result: ConnectorCoreResult, for action: ConnectorCoreAction) -> MacAccessActionResult {
        let actionResult: MacAccessActionResult
        switch result {
        case .blocked(let blocker):
            actionResult = .blocked(blocker)
        case .completed(let completion):
            actionResult = .completed(completion)
        }
        let preserveEmergencyEvidence =
            state.blocker == .emergencyStopActive && (action == .stop || action == .setAccessMode(.off))
        if !preserveEmergencyEvidence {
            lastResult = actionResult
        }
        switch result {
        case .blocked(let blocker):
            if !preserveEmergencyEvidence {
                machine.block(blocker)
            }
        case .completed:
            switch action {
            case .pair:
                machine.markPaired()
            case .unpair, .revokeSelectedVM:
                machine.markUnpaired(action == .unpair ? .notPaired : .revokedGrant)
            case .connect:
                machine.beginConnecting()
                machine.markConnected(at: Date())
            case .disconnect:
                machine.disconnect()
            case .setAccessMode(.off), .stop:
                if !preserveEmergencyEvidence { machine.stop() }
            case .pause:
                machine.pause()
            case .resume:
                machine.resume()
            default:
                break
            }
        }
        state = machine.state
        return actionResult
    }

    private func invalidateCurrentGeneration(because reason: ActionInvalidationReason) {
        if inFlightCounts[actionGeneration, default: 0] > 0 {
            invalidationReasons[actionGeneration] = reason
        }
        actionGeneration &+= 1
    }

    private func invalidatedResult(for generation: Int) -> MacAccessActionResult {
        switch invalidationReasons[generation] {
        case .emergencyStop:
            return .blocked(.emergencyStopActive)
        case .quitCleanup:
            return .invalidated(.quitCleanup)
        case .localPrecondition(let blocker):
            return .invalidated(.localPrecondition(blocker))
        case nil:
            return .blocked(.connectorCoreUnavailable)
        }
    }

    private func finishAction(in generation: Int) {
        let remaining = inFlightCounts[generation, default: 1] - 1
        if remaining > 0 {
            inFlightCounts[generation] = remaining
        } else {
            inFlightCounts[generation] = nil
            invalidationReasons[generation] = nil
        }
    }

    private func localPreconditionBlocker(for action: ConnectorCoreAction) -> MacAccessBlocker? {
        if let blocker = state.blocker {
            switch action {
            case .stop, .setAccessMode(.off):
                break
            case .pair where blocker == .dashboardPairingUnavailable || blocker == .notPaired
                || blocker == .stalePairing || blocker == .revokedGrant:
                break
            default:
                return blocker
            }
        }

        switch action {
        case .connect:
            if !state.isPaired { return .notPaired }
            if state.connection != .disconnected { return .connectorCoreUnavailable }
        case .pause:
            if !state.isPaired { return .notPaired }
            if state.connection != .connected { return .connectorCoreUnavailable }
        case .resume:
            if !state.isPaired { return .notPaired }
            if state.connection != .paused { return .connectorCoreUnavailable }
        default:
            break
        }
        return nil
    }

    private func requestEmergencyStopCleanup() async {
        _ = await client.perform(.stop)
    }

    private static func blocker(
        pairing: String,
        transport: String,
        errorCode: String?
    ) -> MacAccessBlocker? {
        switch errorCode {
        case "invalid_pairing_code": return .invalidPairingCode
        case "pairing_rejected": return .pairingRejected
        case "credential_unavailable": return .credentialUnavailable
        case "relay_unavailable": return .relayUnavailable
        case "policy_unavailable": return .policyUnavailable
        case "revoked": return .revokedGrant
        case "stopped": return .emergencyStopActive
        case .some: return .connectorCoreUnavailable
        case nil:
            if pairing == "revoked" { return .revokedGrant }
            if pairing != "paired" { return .notPaired }
            if transport == "blocked" || transport == "stopped" {
                return .relayUnavailable
            }
            return nil
        }
    }
}
