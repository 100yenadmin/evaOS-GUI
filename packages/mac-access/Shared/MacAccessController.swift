import Combine
import Foundation

@MainActor
public final class MacAccessController: ObservableObject {
    @Published public private(set) var state: MacAccessState
    @Published public private(set) var lastResult: ConnectorCoreResult?

    public let availability: MacAccessActionAvailability
    private let client: any ConnectorCoreClient
    private var machine: MacAccessStateMachine
    private var actionGeneration = 0

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
    public func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        if let blocker = localPreconditionBlocker(for: action) {
            let result = ConnectorCoreResult.blocked(blocker)
            lastResult = result
            return result
        }

        let generation = actionGeneration
        let result = await client.perform(action)
        guard generation == actionGeneration else {
            let stopped = ConnectorCoreResult.blocked(.emergencyStopActive)
            lastResult = stopped
            return stopped
        }
        apply(result, for: action)
        return result
    }

    public func emergencyStop() {
        actionGeneration &+= 1
        machine.emergencyStop()
        state = machine.state
        lastResult = .completed(.localEmergencyStop)
    }

    @discardableResult
    public func prepareToQuit() async -> ConnectorCoreResult {
        actionGeneration &+= 1
        machine.requestQuitCleanup()
        state = machine.state
        return await perform(.stop)
    }

    public func restoreAfterRestart() {
        machine.restoreAfterRestart()
        state = machine.state
    }

    private func apply(_ result: ConnectorCoreResult, for action: ConnectorCoreAction) {
        lastResult = result
        switch result {
        case .blocked(let blocker):
            machine.block(blocker)
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
    }

    private func localPreconditionBlocker(for action: ConnectorCoreAction) -> MacAccessBlocker? {
        if state.blocker == .emergencyStopActive {
            switch action {
            case .stop, .setAccessMode(.off):
                break
            default:
                return .emergencyStopActive
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
