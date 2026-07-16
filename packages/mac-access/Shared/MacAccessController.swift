import Combine
import Foundation

@MainActor
public final class MacAccessController: ObservableObject {
    @Published public private(set) var state: MacAccessState
    @Published public private(set) var lastResult: MacAccessActionResult?

    public let availability: MacAccessActionAvailability
    private let client: any ConnectorCoreClient
    private var machine: MacAccessStateMachine
    private var actionGeneration = 0
    private var inFlightCounts: [Int: Int] = [:]
    private var invalidationReasons: [Int: ActionInvalidationReason] = [:]
    private var quitCleanupInFlight = false

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
        return apply(result, for: action)
    }

    public func emergencyStop() {
        invalidateCurrentGeneration(because: .emergencyStop)
        machine.emergencyStop()
        state = machine.state
        lastResult = .completed(.localEmergencyStop)
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
            case .setAccessMode(.off), .stop:
                machine.selectOff()
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
            default:
                return blocker
            }
        }

        switch action {
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
}
