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

    func waitForActionCount(_ count: Int) async {
        while actions.count < count { await Task.yield() }
    }
}

final actor SequencedConnectorClient: ConnectorCoreClient {
    private var results: [ConnectorCoreResult]
    private var actions: [ConnectorCoreAction] = []

    init(results: [ConnectorCoreResult]) {
        self.results = results
    }

    func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        actions.append(action)
        guard !results.isEmpty else { return .blocked(.connectorCoreUnavailable) }
        return results.removeFirst()
    }

    func recordedActions() -> [ConnectorCoreAction] {
        actions
    }
}

final actor SuspendedConnectorClient: ConnectorCoreClient {
    private var continuations: [(
        action: ConnectorCoreAction,
        continuation: CheckedContinuation<ConnectorCoreResult, Never>
    )] = []

    func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        await withCheckedContinuation { continuation in
            continuations.append((action, continuation))
        }
    }

    func waitUntilSuspended(_ action: ConnectorCoreAction) async {
        while !continuations.contains(where: { $0.action == action }) { await Task.yield() }
    }

    func release(_ action: ConnectorCoreAction, with result: ConnectorCoreResult) {
        guard let index = continuations.firstIndex(where: { $0.action == action }) else {
            XCTFail("no suspended action matched \(action)")
            return
        }
        continuations.remove(at: index).continuation.resume(returning: result)
    }
}

final actor StatusProvidingConnectorClient: MacAccessStatusProvidingClient {
    private let reply: MacAccessXPCReply?

    init(reply: MacAccessXPCReply?) {
        self.reply = reply
    }

    func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        .blocked(.connectorCoreUnavailable)
    }

    func fetchStatus() async -> MacAccessXPCReply? {
        reply
    }
}

@MainActor
final class ControllerTests: XCTestCase {
    func testLaunchProjectionRestoresPairedDisconnectedState() async {
        let client = StatusProvidingConnectorClient(reply: MacAccessXPCReply(
            code: .ok,
            status: MacAccessXPCSafeStatus(
                pairing: "paired", transport: "disconnected",
                lastErrorCode: nil, lastAuditID: "pairing-audit-redacted"
            )
        ))
        let controller = MacAccessController(
            client: client, availability: .pairingTransport
        )

        await controller.refreshFromHelper()

        XCTAssertTrue(controller.state.isPaired)
        XCTAssertEqual(controller.state.connection, .disconnected)
        XCTAssertEqual(controller.state.configuredMode, .off)
        XCTAssertNil(controller.state.blocker)
        XCTAssertTrue(controller.canConnect)
    }

    func testLocalOnlyClientBlocksPairingAndTransport() async {
        let client = LocalOnlyConnectorCoreClient()

        let pairing = await client.perform(.pair("ABCDEFGH2345"))
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

    func testConnectAvailabilityRequiresPairedAndDisconnected() {
        let connected = MacAccessState(
            connection: .connected, configuredMode: .off, effectiveMode: .off,
            isPaired: true, blocker: nil
        )
        let disconnected = MacAccessState(
            connection: .disconnected, configuredMode: .off, effectiveMode: .off,
            isPaired: true, blocker: nil
        )

        XCTAssertFalse(MacAccessController(
            initialState: connected, availability: .pairingTransport
        ).canConnect)
        XCTAssertTrue(MacAccessController(
            initialState: disconnected, availability: .pairingTransport
        ).canConnect)
        XCTAssertFalse(MacAccessController(
            initialState: .safeInitial, availability: .pairingTransport
        ).canConnect)
    }

    func testPairingCodeReachesInjectedClientAndClearsRecoverableInitialBlocker() async {
        let client = RecordingConnectorClient(result: .completed(.paired))
        let availability = MacAccessActionAvailability(
            pairing: true,
            transport: false,
            elevatedAccessModes: false,
            revoke: false,
            update: false
        )
        let controller = MacAccessController(client: client, availability: availability)

        let result = await controller.perform(.pair("ABCDEFGH2345"))
        let actions = await client.recordedActions()

        XCTAssertEqual(result, .completed(.paired))
        XCTAssertEqual(actions, [.pair("ABCDEFGH2345")])
        XCTAssertTrue(controller.state.isPaired)
        XCTAssertEqual(controller.state.connection, .disconnected)
        XCTAssertNil(controller.state.blocker)
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

    func testQuitCanRetryAfterBlockedCleanupWhileRetainingIntentEvidence() async {
        let client = SequencedConnectorClient(results: [
            .blocked(.relayUnavailable),
            .completed(.localStop),
        ])
        let controller = MacAccessController(client: client)

        let firstResult = await controller.prepareToQuit()
        let rejectedOff = await controller.perform(.setAccessMode(.off))
        let secondResult = await controller.prepareToQuit()
        let actions = await client.recordedActions()

        XCTAssertEqual(firstResult, .blocked(.relayUnavailable))
        XCTAssertTrue(controller.state.quitCleanupRequested)
        XCTAssertEqual(rejectedOff, .invalidated(.quitCleanup))
        XCTAssertEqual(secondResult, .completed(.localStop))
        XCTAssertEqual(actions, [.stop, .stop])
        XCTAssertEqual(controller.lastResult, secondResult)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }

    func testSuccessfulQuitCleanupPermanentlyBarsOrdinaryActions() async {
        let client = RecordingConnectorClient(result: .completed(.localStop))
        let connected = MacAccessState(
            connection: .connected,
            configuredMode: .askEveryTime,
            effectiveMode: .askEveryTime,
            isPaired: true,
            blocker: nil
        )
        let controller = MacAccessController(client: client, initialState: connected)

        let quitResult = await controller.prepareToQuit()
        let laterPause = await controller.perform(.pause)
        let laterOff = await controller.perform(.setAccessMode(.off))
        let actions = await client.recordedActions()

        XCTAssertEqual(quitResult, .completed(.localStop))
        XCTAssertEqual(laterPause, .invalidated(.quitCleanup))
        XCTAssertEqual(laterOff, .invalidated(.quitCleanup))
        XCTAssertEqual(actions, [.stop])
        XCTAssertEqual(controller.lastResult, quitResult)
        XCTAssertTrue(controller.state.quitCleanupRequested)
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
        await client.waitUntilSuspended(.pause)
        controller.emergencyStop()
        await client.waitUntilSuspended(.stop)
        await client.release(.stop, with: .blocked(.connectorCoreUnavailable))
        await client.release(.pause, with: .completed(.localPause))
        let actionResult = await action.value

        XCTAssertEqual(actionResult, .blocked(.emergencyStopActive))
        XCTAssertEqual(controller.lastResult, .completed(.localEmergencyStop))
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.blocker, .emergencyStopActive)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }

    func testEmergencyStopSynchronouslyLatchesAndIssuesExactlyOneStop() async {
        let client = RecordingConnectorClient(result: .blocked(.relayUnavailable))
        let connected = MacAccessState(
            connection: .connected,
            configuredMode: .fullAccess,
            effectiveMode: .askEveryTime,
            isPaired: true,
            blocker: nil
        )
        let controller = MacAccessController(client: client, initialState: connected)

        controller.emergencyStop()
        controller.emergencyStop()
        XCTAssertEqual(controller.state.blocker, .emergencyStopActive)
        XCTAssertEqual(controller.state.effectiveMode, .off)
        await client.waitForActionCount(1)
        await Task.yield()
        let actions = await client.recordedActions()

        XCTAssertEqual(actions, [.stop])
        XCTAssertEqual(controller.lastResult, .completed(.localEmergencyStop))
        XCTAssertEqual(controller.state.blocker, .emergencyStopActive)
    }

    func testSuccessfulStopAndOffNoLongerClaimConnected() async {
        let client = RecordingConnectorClient(result: .completed(.localStop))
        let connected = MacAccessState(
            connection: .connected,
            configuredMode: .askEveryTime,
            effectiveMode: .askEveryTime,
            isPaired: true,
            blocker: nil
        )
        let stopController = MacAccessController(client: client, initialState: connected)
        let offController = MacAccessController(client: client, initialState: connected)

        _ = await stopController.perform(.stop)
        _ = await offController.perform(.setAccessMode(.off))

        XCTAssertEqual(stopController.state.connection, .disconnected)
        XCTAssertTrue(stopController.state.isPaired)
        XCTAssertEqual(offController.state.connection, .disconnected)
        XCTAssertTrue(offController.state.isPaired)
    }

    func testFreshUnpairedStateCannotManufacturePausedState() async {
        let controller = MacAccessController()

        let result = await controller.perform(.pause)

        XCTAssertEqual(result, .blocked(.dashboardPairingUnavailable))
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.blocker, .dashboardPairingUnavailable)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }

    func testLocalPreconditionPublishesBlockedOffAndSkipsClient() async {
        let client = RecordingConnectorClient(result: .completed(.localPause))
        let inconsistent = MacAccessState(
            connection: .connected,
            configuredMode: .askEveryTime,
            effectiveMode: .askEveryTime,
            isPaired: false,
            blocker: nil
        )
        let controller = MacAccessController(client: client, initialState: inconsistent)

        let result = await controller.perform(.pause)
        let actions = await client.recordedActions()

        XCTAssertEqual(result, .blocked(.notPaired))
        XCTAssertEqual(controller.lastResult, .blocked(.notPaired))
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.blocker, .notPaired)
        XCTAssertEqual(controller.state.effectiveMode, .off)
        XCTAssertEqual(actions, [])
    }

    func testLocalRejectionInvalidatesOlderCompletionWithoutRestoringAuthority() async {
        let client = SuspendedConnectorClient()
        let connected = MacAccessState(
            connection: .connected,
            configuredMode: .askEveryTime,
            effectiveMode: .askEveryTime,
            isPaired: true,
            blocker: nil
        )
        let controller = MacAccessController(client: client, initialState: connected)

        let pause = Task { await controller.perform(.pause) }
        await client.waitUntilSuspended(.pause)
        let rejectedResume = await controller.perform(.resume)
        await client.release(.pause, with: .completed(.localPause))
        let pauseResult = await pause.value

        XCTAssertEqual(rejectedResume, .blocked(.connectorCoreUnavailable))
        XCTAssertEqual(pauseResult, .invalidated(.localPrecondition(.connectorCoreUnavailable)))
        XCTAssertEqual(controller.lastResult, rejectedResume)
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.blocker, .connectorCoreUnavailable)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }

    func testQuitInvalidationCannotMasqueradeAsEmergencyStopOrOverwriteFailedCleanup() async {
        let client = SuspendedConnectorClient()
        let connected = MacAccessState(
            connection: .connected,
            configuredMode: .askEveryTime,
            effectiveMode: .askEveryTime,
            isPaired: true,
            blocker: nil
        )
        let controller = MacAccessController(client: client, initialState: connected)

        let pause = Task { await controller.perform(.pause) }
        await client.waitUntilSuspended(.pause)
        let quit = Task { await controller.prepareToQuit() }
        await client.waitUntilSuspended(.stop)
        await client.release(.stop, with: .blocked(.connectorCoreUnavailable))
        let quitResult = await quit.value
        await client.release(.pause, with: .completed(.localPause))
        let pauseResult = await pause.value

        XCTAssertEqual(quitResult, .blocked(.connectorCoreUnavailable))
        XCTAssertEqual(pauseResult, .invalidated(.quitCleanup))
        XCTAssertEqual(controller.lastResult, quitResult)
        XCTAssertTrue(controller.state.quitCleanupRequested)
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.blocker, .connectorCoreUnavailable)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }

    func testQuitBarrierRejectsNewActionsWithoutCompetingWithOwnedStop() async {
        let client = SuspendedConnectorClient()
        let connected = MacAccessState(
            connection: .connected,
            configuredMode: .askEveryTime,
            effectiveMode: .askEveryTime,
            isPaired: true,
            blocker: nil
        )
        let controller = MacAccessController(client: client, initialState: connected)

        let quit = Task { await controller.prepareToQuit() }
        await client.waitUntilSuspended(.stop)
        let laterPause = await controller.perform(.pause)
        await client.release(.stop, with: .blocked(.relayUnavailable))
        let quitResult = await quit.value

        XCTAssertEqual(laterPause, .invalidated(.quitCleanup))
        XCTAssertEqual(quitResult, .blocked(.relayUnavailable))
        XCTAssertEqual(controller.lastResult, quitResult)
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.blocker, .relayUnavailable)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }

    func testQuitBarrierRejectsOffWithoutInvalidatingOwnedStop() async {
        let client = SuspendedConnectorClient()
        let controller = MacAccessController(client: client)

        let quit = Task { await controller.prepareToQuit() }
        await client.waitUntilSuspended(.stop)
        let laterOff = await controller.perform(.setAccessMode(.off))
        await client.release(.stop, with: .completed(.localStop))
        let quitResult = await quit.value

        XCTAssertEqual(laterOff, .invalidated(.quitCleanup))
        XCTAssertEqual(quitResult, .completed(.localStop))
        XCTAssertEqual(controller.lastResult, quitResult)
        XCTAssertTrue(controller.state.quitCleanupRequested)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }

    func testQuitBarrierRejectsBlockedActionWithoutInvalidatingOwnedStop() async {
        let client = SuspendedConnectorClient()
        let blocked = MacAccessState(
            connection: .blocked,
            configuredMode: .askEveryTime,
            effectiveMode: .off,
            isPaired: true,
            blocker: .permissionDenied
        )
        let controller = MacAccessController(client: client, initialState: blocked)

        let quit = Task { await controller.prepareToQuit() }
        await client.waitUntilSuspended(.stop)
        let laterPause = await controller.perform(.pause)
        await client.release(.stop, with: .completed(.localStop))
        let quitResult = await quit.value

        XCTAssertEqual(laterPause, .invalidated(.quitCleanup))
        XCTAssertEqual(quitResult, .completed(.localStop))
        XCTAssertEqual(controller.state.blocker, .permissionDenied)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }

    func testSecondQuitCannotInvalidateOwnedStop() async {
        let client = SuspendedConnectorClient()
        let controller = MacAccessController(client: client)

        let firstQuit = Task { await controller.prepareToQuit() }
        await client.waitUntilSuspended(.stop)
        let secondQuit = await controller.prepareToQuit()
        await client.release(.stop, with: .completed(.localStop))
        let firstResult = await firstQuit.value

        XCTAssertEqual(secondQuit, .invalidated(.quitCleanup))
        XCTAssertEqual(firstResult, .completed(.localStop))
        XCTAssertEqual(controller.lastResult, firstResult)
    }

    func testConcurrentAcceptedActionInvalidatesTheOlderOwnerAndFailsClosed() async {
        let client = SuspendedConnectorClient()
        let connected = MacAccessState(
            connection: .connected,
            configuredMode: .askEveryTime,
            effectiveMode: .askEveryTime,
            isPaired: true,
            blocker: nil
        )
        let controller = MacAccessController(client: client, initialState: connected)

        let firstPause = Task { await controller.perform(.pause) }
        await client.waitUntilSuspended(.pause)
        let competingPause = await controller.perform(.pause)
        await client.release(.pause, with: .completed(.localPause))
        let firstResult = await firstPause.value

        XCTAssertEqual(competingPause, .blocked(.connectorCoreUnavailable))
        XCTAssertEqual(firstResult, .invalidated(.localPrecondition(.connectorCoreUnavailable)))
        XCTAssertEqual(controller.lastResult, competingPause)
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.blocker, .connectorCoreUnavailable)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }

    func testControllerPreservesExistingRecoveryBlocker() async {
        let client = RecordingConnectorClient(result: .completed(.localPause))
        let blocked = MacAccessState(
            connection: .blocked,
            configuredMode: .askEveryTime,
            effectiveMode: .off,
            isPaired: false,
            blocker: .permissionDenied
        )
        let controller = MacAccessController(client: client, initialState: blocked)

        let result = await controller.perform(.pause)
        let actions = await client.recordedActions()

        XCTAssertEqual(result, .blocked(.permissionDenied))
        XCTAssertEqual(controller.lastResult, result)
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.blocker, .permissionDenied)
        XCTAssertEqual(controller.state.effectiveMode, .off)
        XCTAssertEqual(actions, [])
    }

    func testFailedQuitCleanupCannotClearEmergencyStopEvidence() async {
        let client = RecordingConnectorClient(result: .blocked(.connectorCoreUnavailable))
        let controller = MacAccessController(client: client)

        controller.emergencyStop()
        let quitResult = await controller.prepareToQuit()

        XCTAssertEqual(quitResult, .blocked(.connectorCoreUnavailable))
        XCTAssertEqual(controller.lastResult, .completed(.localEmergencyStop))
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.blocker, .emergencyStopActive)
        XCTAssertEqual(controller.state.configuredMode, .off)
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
        await client.waitForActionCount(1)
        let actions = await client.recordedActions()

        XCTAssertEqual(result, .blocked(.emergencyStopActive))
        XCTAssertEqual(controller.state.connection, .blocked)
        XCTAssertEqual(controller.state.blocker, .emergencyStopActive)
        XCTAssertEqual(controller.state.effectiveMode, .off)
        XCTAssertEqual(actions, [.stop])
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
