import XCTest
@testable import MacAccessShared

final actor RecordingConnectorClient: ConnectorCoreClient {
    private var actions: [ConnectorCoreAction] = []
    private let result: ConnectorCoreResult

    init(result: ConnectorCoreResult = .completed(.localStop)) {
        self.result = result
    }

    func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        actions.append(action)
        return result
    }

    func recordedActions() -> [ConnectorCoreAction] {
        actions
    }
}

final actor SuspendedConnectorClient: ConnectorCoreClient {
    private var continuation: CheckedContinuation<ConnectorCoreResult, Never>?

    func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        await withCheckedContinuation { continuation = $0 }
    }

    func waitUntilSuspended() async {
        while continuation == nil { await Task.yield() }
    }

    func release(with result: ConnectorCoreResult) {
        continuation?.resume(returning: result)
        continuation = nil
    }
}

@MainActor
final class ControllerTests: XCTestCase {
    func testLocalOnlyClientBlocksPairingAndTransport() async {
        let client = LocalOnlyConnectorCoreClient()

        let pairing = await client.perform(.pair)
        let transport = await client.perform(.connect)

        XCTAssertEqual(pairing, .blocked(.dashboardPairingUnavailable))
        XCTAssertEqual(transport, .blocked(.relayUnavailable))
    }

    func testUnavailableActionsAreAdvertisedAsDisabled() {
        let availability = MacAccessActionAvailability.localOnly

        XCTAssertFalse(availability.pairing)
        XCTAssertFalse(availability.transport)
        XCTAssertFalse(availability.elevatedAccessModes)
        XCTAssertFalse(availability.revoke)
        XCTAssertFalse(availability.update)
    }

    func testQuitRecordsCleanupIntentBeforeRequestingStop() async {
        let client = RecordingConnectorClient()
        let controller = MacAccessController(client: client)

        let result = await controller.prepareToQuit()
        let actions = await client.recordedActions()

        XCTAssertEqual(result, .completed(.localStop))
        XCTAssertTrue(controller.state.quitCleanupRequested)
        XCTAssertEqual(controller.state.effectiveMode, .off)
        XCTAssertEqual(actions, [.stop])
    }

    func testQuitReturnsBlockedCleanupInsteadOfClaimingSuccess() async {
        let client = RecordingConnectorClient(result: .blocked(.connectorCoreUnavailable))
        let controller = MacAccessController(client: client)

        let result = await controller.prepareToQuit()

        XCTAssertEqual(result, .blocked(.connectorCoreUnavailable))
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }

    func testEmergencyStopInvalidatesAnInFlightPauseCompletion() async {
        let client = SuspendedConnectorClient()
        let connected = MacAccessState(
            connection: .connected,
            configuredMode: .askEveryTime,
            effectiveMode: .askEveryTime,
            isPaired: true,
            blocker: nil
        )
        let controller = MacAccessController(client: client, initialState: connected)

        let action = Task { await controller.perform(.pause) }
        await client.waitUntilSuspended()
        controller.emergencyStop()
        await client.release(with: .completed(.localPause))
        let actionResult = await action.value

        XCTAssertEqual(actionResult, .blocked(.emergencyStopActive))
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.blocker, .emergencyStopActive)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }

    func testFreshUnpairedStateCannotManufacturePausedState() async {
        let controller = MacAccessController()

        let result = await controller.perform(.pause)

        XCTAssertEqual(result, .blocked(.notPaired))
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }

    func testEmergencyStopRejectsLaterPauseWithoutClearingTheLatch() async {
        let client = RecordingConnectorClient(result: .completed(.localPause))
        let connected = MacAccessState(
            connection: .connected,
            configuredMode: .askEveryTime,
            effectiveMode: .askEveryTime,
            isPaired: true,
            blocker: nil
        )
        let controller = MacAccessController(client: client, initialState: connected)

        controller.emergencyStop()
        let result = await controller.perform(.pause)
        let actions = await client.recordedActions()

        XCTAssertEqual(result, .blocked(.emergencyStopActive))
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.blocker, .emergencyStopActive)
        XCTAssertEqual(controller.state.effectiveMode, .off)
        XCTAssertEqual(actions, [])
    }

    func testBlockedDependencyForcesControllerOff() async {
        let client = RecordingConnectorClient(result: .blocked(.relayUnavailable))
        let paired = MacAccessState(
            connection: .disconnected,
            configuredMode: .askEveryTime,
            effectiveMode: .off,
            isPaired: true,
            blocker: nil
        )
        let controller = MacAccessController(client: client, initialState: paired)

        let result = await controller.perform(.connect)

        XCTAssertEqual(result, .blocked(.relayUnavailable))
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }
}
