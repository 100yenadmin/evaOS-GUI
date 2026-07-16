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

final actor ProjectingConnectorClient: MacAccessStatusProjectingClient {
    var reply: MacAccessXPCReply

    init(reply: MacAccessXPCReply) { self.reply = reply }

    func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        .completed(.localStop)
    }

    func fetchStatus() async -> MacAccessXPCReply? { reply }

    func resolvePendingApproval(
        _ approval: MacAccessXPCApproval, allow: Bool
    ) async -> MacAccessXPCReply? {
        reply
    }
}

final actor SuspendedStatusConnectorClient: MacAccessStatusProjectingClient {
    private var continuation: CheckedContinuation<MacAccessXPCReply?, Never>?
    private var fetchStarted = false

    func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        .blocked(.connectorCoreUnavailable)
    }

    func fetchStatus() async -> MacAccessXPCReply? {
        fetchStarted = true
        return await withCheckedContinuation { continuation = $0 }
    }

    func resolvePendingApproval(
        _ approval: MacAccessXPCApproval, allow: Bool
    ) async -> MacAccessXPCReply? { nil }

    func waitUntilFetchStarts() async {
        while !fetchStarted { await Task.yield() }
    }

    func releaseStatus(_ reply: MacAccessXPCReply) {
        continuation?.resume(returning: reply)
        continuation = nil
    }
}

final actor SuspendedKillProjectingConnectorClient: MacAccessStatusProjectingClient {
    private var continuation: CheckedContinuation<ConnectorCoreResult, Never>?
    private var killStarted = false
    private var killConfirmed = false
    private var fetchCount = 0

    func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        guard action == .activateKillSwitch else { return .blocked(.connectorCoreUnavailable) }
        killStarted = true
        return await withCheckedContinuation { continuation = $0 }
    }

    func fetchStatus() -> MacAccessXPCReply? {
        fetchCount += 1
        return MacAccessXPCReply(
            code: .ok,
            status: MacAccessXPCSafeStatus(
                pairing: "paired", transport: killConfirmed ? "blocked" : "connected",
                lastErrorCode: nil, lastAuditID: nil,
                configuredMode: killConfirmed ? "off" : "ask_every_time",
                effectiveMode: killConfirmed ? "off" : "ask_every_time",
                paused: killConfirmed, killSwitch: killConfirmed,
                policyEpoch: killConfirmed ? 8 : 7,
                policyProvider: "mac_connector_core"
            )
        )
    }

    func resolvePendingApproval(
        _ approval: MacAccessXPCApproval, allow: Bool
    ) async -> MacAccessXPCReply? { nil }

    func waitUntilKillStarts() async {
        while !killStarted { await Task.yield() }
    }

    func confirmKill() {
        killConfirmed = true
        continuation?.resume(returning: .completed(.localEmergencyStop))
        continuation = nil
    }

    func waitForFetchCount(_ expected: Int) async {
        while fetchCount < expected { await Task.yield() }
    }
}

@MainActor
private final class FakeMacAccessLoginItemService: MacAccessLoginItemServicing {
    enum Failure: Error { case requested }

    var state: MacAccessLoginItemState
    var stateAfterRegister: MacAccessLoginItemState = .enabled
    var stateAfterUnregister: MacAccessLoginItemState = .notRegistered
    var registerFails = false
    var unregisterFails = false
    private(set) var registerCount = 0
    private(set) var unregisterCount = 0

    init(state: MacAccessLoginItemState) {
        self.state = state
    }

    func register() throws {
        registerCount += 1
        if registerFails { throw Failure.requested }
        state = stateAfterRegister
    }

    func unregister() async throws {
        unregisterCount += 1
        if unregisterFails { throw Failure.requested }
        state = stateAfterUnregister
    }
}

@MainActor
final class ControllerTests: XCTestCase {
    func testLoginItemRegistrationIsIdempotentAndSurfacesApproval() {
        let service = FakeMacAccessLoginItemService(state: .notRegistered)
        let delegate = MacAccessAppDelegate(loginItemService: service)

        XCTAssertEqual(delegate.registerLoginItemIfNeeded(), .enabled)
        XCTAssertEqual(delegate.registerLoginItemIfNeeded(), .enabled)
        XCTAssertEqual(service.registerCount, 1)

        let approvalService = FakeMacAccessLoginItemService(state: .requiresApproval)
        let approvalDelegate = MacAccessAppDelegate(loginItemService: approvalService)
        XCTAssertEqual(approvalDelegate.registerLoginItemIfNeeded(), .requiresApproval)
        XCTAssertEqual(approvalService.registerCount, 0)

        let missingRecordService = FakeMacAccessLoginItemService(state: .notFound)
        let missingRecordDelegate = MacAccessAppDelegate(loginItemService: missingRecordService)
        XCTAssertEqual(missingRecordDelegate.registerLoginItemIfNeeded(), .enabled)
        XCTAssertEqual(missingRecordService.registerCount, 1)
    }

    func testPrepareForUninstallRevokesBeforeUnregistering() async {
        let client = RecordingConnectorClient(result: .completed(.revoked))
        let controller = MacAccessController(
            client: client,
            initialState: MacAccessState(
                connection: .connected, configuredMode: .fullAccess,
                effectiveMode: .fullAccess, isPaired: true, blocker: nil
            ),
            availability: .standalonePolicy
        )
        let service = FakeMacAccessLoginItemService(state: .enabled)
        let delegate = MacAccessAppDelegate(loginItemService: service)
        delegate.controller = controller

        let prepared = await delegate.prepareForUninstall()
        let actions = await client.recordedActions()
        XCTAssertTrue(prepared)
        XCTAssertEqual(actions, [.revokeSelectedVM])
        XCTAssertEqual(service.unregisterCount, 1)
        XCTAssertEqual(delegate.loginItemState, .notRegistered)
        XCTAssertEqual(controller.state.effectiveMode, .off)
        XCTAssertEqual(controller.state.blocker, .revokedGrant)
    }

    func testPrepareForUninstallKeepsAppRegisteredWhenRevokeFails() async {
        let client = RecordingConnectorClient(result: .blocked(.credentialUnavailable))
        let controller = MacAccessController(client: client, availability: .standalonePolicy)
        let service = FakeMacAccessLoginItemService(state: .enabled)
        let delegate = MacAccessAppDelegate(loginItemService: service)
        delegate.controller = controller

        let prepared = await delegate.prepareForUninstall()
        XCTAssertFalse(prepared)
        XCTAssertEqual(service.unregisterCount, 0)
        XCTAssertEqual(service.state, .enabled)
    }

    func testPrepareForUninstallLeavesRevokedAppRunningWhenUnregisterFails() async {
        let client = RecordingConnectorClient(result: .completed(.revoked))
        let controller = MacAccessController(client: client, availability: .standalonePolicy)
        let service = FakeMacAccessLoginItemService(state: .enabled)
        service.unregisterFails = true
        let delegate = MacAccessAppDelegate(loginItemService: service)
        delegate.controller = controller

        let prepared = await delegate.prepareForUninstall()
        XCTAssertFalse(prepared)
        XCTAssertEqual(service.unregisterCount, 1)
        XCTAssertEqual(delegate.loginItemState, .failed)
        XCTAssertEqual(controller.state.effectiveMode, .off)
        XCTAssertEqual(controller.state.blocker, .revokedGrant)
    }

    func testPrepareForUninstallDoesNotTreatMissingLoginItemAsUnregistered() async {
        let client = RecordingConnectorClient(result: .completed(.revoked))
        let controller = MacAccessController(client: client, availability: .standalonePolicy)
        let service = FakeMacAccessLoginItemService(state: .notFound)
        service.stateAfterUnregister = .notFound
        let delegate = MacAccessAppDelegate(loginItemService: service)
        delegate.controller = controller

        let prepared = await delegate.prepareForUninstall()
        XCTAssertFalse(prepared)
        XCTAssertEqual(service.unregisterCount, 1)
        XCTAssertEqual(delegate.loginItemState, .notFound)
        XCTAssertEqual(controller.state.effectiveMode, .off)
        XCTAssertEqual(controller.state.blocker, .revokedGrant)
    }

    func testAuthoritativeHelperProjectionHydratesFullAccessAndAudit() async {
        let event = MacAccessXPCAuditEvent(
            occurredAt: Date(timeIntervalSince1970: 1_700_000_000),
            capability: "customer_mac.desktop_click",
            outcome: "executed",
            reasonCode: "approved_exact_scope"
        )
        let client = ProjectingConnectorClient(reply: MacAccessXPCReply(
            code: .ok,
            status: MacAccessXPCSafeStatus(
                pairing: "paired", transport: "connected", lastErrorCode: nil,
                lastAuditID: "audit-01", configuredMode: "full_access",
                effectiveMode: "full_access", paused: false, killSwitch: false,
                policyEpoch: 7, policyProvider: "mac_connector_core", auditEventCount: 1,
                recentAuditEvents: [event]
            )
        ))
        let controller = MacAccessController(client: client, availability: .standalonePolicy)

        await controller.refreshFromHelper()

        XCTAssertTrue(controller.state.isPaired)
        XCTAssertEqual(controller.state.connection, .connected)
        XCTAssertEqual(controller.state.configuredMode, .fullAccess)
        XCTAssertEqual(controller.state.effectiveMode, .fullAccess)
        XCTAssertEqual(controller.recentAuditEvents, [event])
    }

    func testStaleStatusRefreshCannotOverwriteEmergencyStop() async {
        let client = SuspendedStatusConnectorClient()
        let controller = MacAccessController(
            client: client,
            initialState: MacAccessState(
                connection: .connected, configuredMode: .askEveryTime,
                effectiveMode: .askEveryTime, isPaired: true, blocker: nil
            ),
            availability: .standalonePolicy
        )
        let refresh = Task { await controller.refreshFromHelper() }
        await client.waitUntilFetchStarts()

        controller.emergencyStop()
        await client.releaseStatus(MacAccessXPCReply(
            code: .ok,
            status: MacAccessXPCSafeStatus(
                pairing: "paired", transport: "connected", lastErrorCode: nil,
                lastAuditID: nil, configuredMode: "ask_every_time",
                effectiveMode: "ask_every_time", paused: false, killSwitch: false,
                policyEpoch: 7, policyProvider: "mac_connector_core"
            )
        ))
        await refresh.value

        XCTAssertEqual(controller.state.blocker, .emergencyStopActive)
        XCTAssertEqual(controller.state.effectiveMode, .off)
    }

    func testPostStopPollCannotOverwriteEmergencyLatchBeforeHelperConfirmsKill() async {
        let client = SuspendedKillProjectingConnectorClient()
        let controller = MacAccessController(
            client: client,
            initialState: MacAccessState(
                connection: .connected, configuredMode: .askEveryTime,
                effectiveMode: .askEveryTime, isPaired: true, blocker: nil
            ),
            availability: .standalonePolicy
        )

        controller.emergencyStop()
        await client.waitUntilKillStarts()
        await controller.refreshFromHelper()

        XCTAssertEqual(controller.state.blocker, .emergencyStopActive)
        XCTAssertEqual(controller.state.effectiveMode, .off)

        await client.confirmKill()
        await client.waitForFetchCount(2)
        XCTAssertEqual(controller.state.blocker, .emergencyStopActive)
    }

    func testDisconnectedProjectionDoesNotBecomePausedFromStaleFlag() async {
        let client = ProjectingConnectorClient(reply: MacAccessXPCReply(
            code: .ok,
            status: MacAccessXPCSafeStatus(
                pairing: "paired", transport: "disconnected", lastErrorCode: "stopped",
                lastAuditID: nil, configuredMode: "off", effectiveMode: "off",
                paused: true, killSwitch: false, policyEpoch: 9,
                policyProvider: "mac_connector_core"
            )
        ))
        let controller = MacAccessController(client: client, availability: .standalonePolicy)

        await controller.refreshFromHelper()

        XCTAssertEqual(controller.state.connection, .disconnected)
        XCTAssertTrue(controller.canConnect)
    }

    func testEmergencyStopRetriesAfterHelperDispatchFailure() async {
        let client = RecordingConnectorClient(result: .blocked(.connectorCoreUnavailable))
        let controller = MacAccessController(
            client: client,
            initialState: MacAccessState(
                connection: .connected, configuredMode: .askEveryTime,
                effectiveMode: .askEveryTime, isPaired: true, blocker: nil
            ),
            availability: .standalonePolicy
        )

        controller.emergencyStop()
        await client.waitForActionCount(1)
        try? await Task.sleep(for: .milliseconds(10))
        controller.emergencyStop()
        await client.waitForActionCount(2)

        let actions = await client.recordedActions()
        XCTAssertEqual(actions, [.activateKillSwitch, .activateKillSwitch])
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
        await client.waitUntilSuspended(.activateKillSwitch)
        await client.release(.activateKillSwitch, with: .blocked(.connectorCoreUnavailable))
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

        XCTAssertEqual(actions, [.activateKillSwitch])
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
        XCTAssertEqual(actions, [.activateKillSwitch])
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
