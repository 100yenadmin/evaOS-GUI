import Combine
import Foundation

@MainActor
public final class MacAccessController: ObservableObject {
    @Published public private(set) var state: MacAccessState
    @Published public private(set) var lastResult: MacAccessActionResult?
    @Published public private(set) var pendingApproval: MacAccessXPCPendingApproval?
    @Published public private(set) var recentAuditEvents: [MacAccessXPCAuditEvent] = []

    public let availability: MacAccessActionAvailability
    private let client: any ConnectorCoreClient
    private var machine: MacAccessStateMachine
    private var actionGeneration = 0
    private var inFlightCounts: [Int: Int] = [:]
    private var invalidationReasons: [Int: ActionInvalidationReason] = [:]
    private var quitCleanupInFlight = false
    private var emergencyStopCleanupIssued = false
    private var projectionGeneration = 0

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

    @discardableResult
    public func perform(_ action: ConnectorCoreAction) async -> MacAccessActionResult {
        await perform(action, ownsQuitCleanup: false)
    }

    private func perform(
        _ action: ConnectorCoreAction,
        ownsQuitCleanup: Bool
    ) async -> MacAccessActionResult {
        invalidateProjection()
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

    public func refreshFromHelper() async {
        projectionGeneration &+= 1
        let generation = projectionGeneration
        guard let client = client as? any MacAccessStatusProjectingClient,
              let reply = await client.fetchStatus(),
              reply.status.policyProvider == "mac_connector_core",
              generation == projectionGeneration
        else { return }
        applyAuthoritativeStatus(reply.status)
    }

    public func resolvePendingApproval(allow: Bool) async {
        projectionGeneration &+= 1
        let generation = projectionGeneration
        guard let pendingApproval,
              let client = client as? any MacAccessStatusProjectingClient,
              let reply = await client.resolvePendingApproval(
                  pendingApproval.approval, allow: allow
              ), reply.code == .ok,
              generation == projectionGeneration
        else {
            await refreshFromHelper()
            return
        }
        applyAuthoritativeStatus(reply.status)
    }

    public func emergencyStop() {
        invalidateProjection()
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
        invalidateProjection()
        invalidateCurrentGeneration(because: .quitCleanup)
        machine.requestQuitCleanup()
        state = machine.state
        quitCleanupInFlight = true
        defer { quitCleanupInFlight = false }
        return await perform(.stop, ownsQuitCleanup: true)
    }

    public func restoreAfterRestart() {
        invalidateProjection()
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
            case .setAccessMode(.off), .stop, .activateKillSwitch:
                if !preserveEmergencyEvidence { machine.stop() }
            case .clearKillSwitch:
                emergencyStopCleanupIssued = false
                machine.markUnpaired(.notPaired)
            case .setAccessMode(let mode):
                machine.setAccessMode(mode)
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
            case .stop, .activateKillSwitch, .setAccessMode(.off), .clearKillSwitch:
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
        let result = await client.perform(.activateKillSwitch)
        guard result == .completed(.localEmergencyStop) else {
            emergencyStopCleanupIssued = false
            return
        }
        await refreshFromHelper()
    }

    private func invalidateProjection() {
        projectionGeneration &+= 1
    }

    private func applyAuthoritativeStatus(_ status: MacAccessXPCSafeStatus) {
        guard let configured = Self.mode(status.configuredMode),
              let effective = Self.mode(status.effectiveMode),
              let paused = status.paused,
              let killSwitch = status.killSwitch,
              status.policyEpoch != nil
        else { return }
        let isPaired = status.pairing == "paired"
        let connection: MacAccessConnectionState
        let blocker: MacAccessBlocker?
        if killSwitch {
            connection = .blocked
            blocker = .emergencyStopActive
        } else if status.pendingApproval != nil {
            connection = .approvalNeeded
            blocker = nil
        } else if paused {
            connection = .paused
            blocker = nil
        } else {
            switch status.transport {
            case "connected": connection = .connected; blocker = nil
            case "connecting": connection = .connecting; blocker = nil
            case "disconnected" where isPaired, "stopped" where isPaired:
                connection = .disconnected; blocker = nil
            case "blocked":
                connection = .blocked
                blocker = Self.blocker(status.lastErrorCode) ?? .connectorCoreUnavailable
            default:
                connection = .blocked
                blocker = Self.blocker(status.lastErrorCode) ?? (isPaired ? .connectorCoreUnavailable : .notPaired)
            }
        }
        let projected = MacAccessState(
            connection: connection,
            configuredMode: configured,
            effectiveMode: effective,
            isPaired: isPaired,
            blocker: blocker,
            lastActivityAt: status.recentAuditEvents?.first?.occurredAt,
            emergencyStopCount: state.emergencyStopCount,
            quitCleanupRequested: state.quitCleanupRequested
        )
        machine = MacAccessStateMachine(state: projected)
        state = projected
        if killSwitch { emergencyStopCleanupIssued = true }
        pendingApproval = status.pendingApproval
        recentAuditEvents = status.recentAuditEvents ?? []
    }

    private static func mode(_ value: String?) -> MacAccessMode? {
        switch value {
        case "off": .off
        case "ask_every_time": .askEveryTime
        case "full_access": .fullAccess
        default: nil
        }
    }

    private static func blocker(_ code: String?) -> MacAccessBlocker? {
        switch code {
        case "invalid_pairing_code": .invalidPairingCode
        case "pairing_rejected": .pairingRejected
        case "credential_unavailable": .credentialUnavailable
        case "policy_unavailable": .policyUnavailable
        case "configuration_unavailable": .dashboardPairingUnavailable
        case "relay_unavailable": .relayUnavailable
        case "revoked": .revokedGrant
        case "stopped": nil
        default: nil
        }
    }
}
