import XCTest
@testable import MacAccessShared

final class AccessStateTests: XCTestCase {
    func testFreshStateIsBlockedUnpairedAndOff() {
        let state = MacAccessState.safeInitial

        XCTAssertEqual(state.connection, .blocked)
        XCTAssertFalse(state.isPaired)
        XCTAssertEqual(state.configuredMode, .off)
        XCTAssertEqual(state.effectiveMode, .off)
    }

    func testStateMachineCoversEveryVisibleConnectionState() {
        var state = MacAccessState(
            connection: .disconnected,
            configuredMode: .askEveryTime,
            effectiveMode: .off,
            isPaired: true,
            blocker: nil
        )
        var machine = MacAccessStateMachine(state: state)

        machine.beginConnecting()
        XCTAssertEqual(machine.state.connection, .connecting)
        machine.requireApproval()
        XCTAssertEqual(machine.state.connection, .approvalNeeded)
        machine.markConnected(at: Date(timeIntervalSince1970: 1))
        XCTAssertEqual(machine.state.connection, .connected)
        machine.pause()
        XCTAssertEqual(machine.state.connection, .paused)
        machine.resume()
        XCTAssertEqual(machine.state.connection, .disconnected)
        machine.block(.relayUnavailable)
        XCTAssertEqual(machine.state.connection, .blocked)

        state = machine.state
        XCTAssertEqual(state.effectiveMode, .off)
    }

    func testConnectingWhileUnpairedPreservesExistingRecoveryBlocker() {
        var machine = MacAccessStateMachine()

        machine.beginConnecting()

        XCTAssertEqual(machine.state.connection, .blocked)
        XCTAssertEqual(machine.state.blocker, .dashboardPairingUnavailable)
        XCTAssertEqual(machine.state.effectiveMode, .off)
    }

    func testConnectingWhileUnpairedWithoutExistingBlockerFailsClosedAsNotPaired() {
        let state = MacAccessState(
            connection: .disconnected,
            configuredMode: .off,
            effectiveMode: .off,
            isPaired: false,
            blocker: nil
        )
        var machine = MacAccessStateMachine(state: state)

        machine.beginConnecting()

        XCTAssertEqual(machine.state.connection, .blocked)
        XCTAssertEqual(machine.state.blocker, .notPaired)
        XCTAssertEqual(machine.state.effectiveMode, .off)
    }

    func testRestartDowngradesFullAccessAndClearsEffectiveAuthority() {
        let state = MacAccessState(
            connection: .connected,
            configuredMode: .fullAccess,
            effectiveMode: .fullAccess,
            isPaired: true,
            blocker: nil
        )
        var machine = MacAccessStateMachine(state: state)

        machine.restoreAfterRestart()

        XCTAssertEqual(machine.state.configuredMode, .askEveryTime)
        XCTAssertEqual(machine.state.effectiveMode, .off)
        XCTAssertEqual(machine.state.connection, .disconnected)
    }

    func testConnectDoesNotMakeFullAccessEffectiveWithoutRuntimeConfirmation() {
        let state = MacAccessState(
            connection: .connecting,
            configuredMode: .fullAccess,
            effectiveMode: .off,
            isPaired: true,
            blocker: nil
        )
        var machine = MacAccessStateMachine(state: state)

        machine.markConnected(at: Date(timeIntervalSince1970: 1))

        XCTAssertEqual(machine.state.connection, .connected)
        XCTAssertEqual(machine.state.effectiveMode, .askEveryTime)
    }

    func testConnectedConfirmationPreservesEveryExistingBlocker() {
        let blockers: [MacAccessBlocker] = [.permissionDenied, .coreCrashed, .emergencyStopActive]

        for blocker in blockers {
            let state = MacAccessState(
                connection: .blocked,
                configuredMode: .askEveryTime,
                effectiveMode: .off,
                isPaired: true,
                blocker: blocker
            )
            var machine = MacAccessStateMachine(state: state)

            machine.markConnected(at: Date(timeIntervalSince1970: 1))

            XCTAssertEqual(machine.state.connection, .blocked)
            XCTAssertEqual(machine.state.effectiveMode, .off)
            XCTAssertEqual(machine.state.blocker, blocker)
            XCTAssertNil(machine.state.lastActivityAt)
        }
    }

    func testConnectionStartCannotClearAnExistingRecoveryBlocker() {
        let blockers: [MacAccessBlocker] = [.permissionDenied, .coreCrashed, .emergencyStopActive]

        for blocker in blockers {
            let state = MacAccessState(
                connection: .blocked,
                configuredMode: .askEveryTime,
                effectiveMode: .off,
                isPaired: true,
                blocker: blocker
            )
            var machine = MacAccessStateMachine(state: state)

            machine.beginConnecting()
            machine.markConnected(at: Date(timeIntervalSince1970: 1))

            XCTAssertEqual(machine.state.connection, .blocked)
            XCTAssertEqual(machine.state.blocker, blocker)
            XCTAssertEqual(machine.state.effectiveMode, .off)
            XCTAssertNil(machine.state.lastActivityAt)
        }
    }

    func testConnectedConfirmationRequiresAnActiveConnectionTransition() {
        let state = MacAccessState(
            connection: .disconnected,
            configuredMode: .askEveryTime,
            effectiveMode: .off,
            isPaired: true,
            blocker: nil
        )
        var machine = MacAccessStateMachine(state: state)

        machine.markConnected(at: Date(timeIntervalSince1970: 1))

        XCTAssertEqual(machine.state.connection, .blocked)
        XCTAssertEqual(machine.state.effectiveMode, .off)
        XCTAssertEqual(machine.state.blocker, .connectorCoreUnavailable)
        XCTAssertNil(machine.state.lastActivityAt)
    }

    func testPauseGuardsAreEnforcedInsideTheStateMachine() {
        var unpaired = MacAccessStateMachine()
        unpaired.pause()
        XCTAssertEqual(unpaired.state.connection, .blocked)
        XCTAssertEqual(unpaired.state.blocker, .dashboardPairingUnavailable)
        XCTAssertEqual(unpaired.state.effectiveMode, .off)

        let disconnectedState = MacAccessState(
            connection: .disconnected,
            configuredMode: .askEveryTime,
            effectiveMode: .off,
            isPaired: true,
            blocker: nil
        )
        var disconnected = MacAccessStateMachine(state: disconnectedState)
        disconnected.pause()
        XCTAssertEqual(disconnected.state.connection, .blocked)
        XCTAssertEqual(disconnected.state.blocker, .connectorCoreUnavailable)
        XCTAssertEqual(disconnected.state.effectiveMode, .off)

        let emergencyState = MacAccessState(
            connection: .blocked,
            configuredMode: .off,
            effectiveMode: .off,
            isPaired: false,
            blocker: .emergencyStopActive
        )
        var emergency = MacAccessStateMachine(state: emergencyState)
        emergency.pause()
        XCTAssertEqual(emergency.state.connection, .blocked)
        XCTAssertEqual(emergency.state.blocker, .emergencyStopActive)
        XCTAssertEqual(emergency.state.effectiveMode, .off)
    }

    func testResumeCannotClearAPairedBlockedState() {
        let state = MacAccessState(
            connection: .blocked,
            configuredMode: .off,
            effectiveMode: .off,
            isPaired: true,
            blocker: .emergencyStopActive
        )
        var machine = MacAccessStateMachine(state: state)

        machine.resume()

        XCTAssertEqual(machine.state.connection, .blocked)
        XCTAssertEqual(machine.state.blocker, .emergencyStopActive)
        XCTAssertEqual(machine.state.effectiveMode, .off)
    }

    func testEveryRecoveryBlockerForcesBlockedOff() {
        let blockers: [MacAccessBlocker] = [
            .permissionDenied,
            .stalePairing,
            .revokedGrant,
            .offlineBroker,
            .coreCrashed,
            .updateRequired,
            .conflictingWorkbenchOwner,
        ]

        for blocker in blockers {
            var machine = MacAccessStateMachine()
            machine.block(blocker)
            XCTAssertEqual(machine.state.connection, .blocked)
            XCTAssertEqual(machine.state.effectiveMode, .off)
            XCTAssertEqual(machine.state.blocker, blocker)
        }
    }

    func testEmergencyStopIsIdempotent() {
        var machine = MacAccessStateMachine()

        machine.emergencyStop()
        machine.emergencyStop()

        XCTAssertEqual(machine.state.emergencyStopCount, 1)
        XCTAssertEqual(machine.state.configuredMode, .off)
        XCTAssertEqual(machine.state.effectiveMode, .off)
        XCTAssertEqual(machine.state.blocker, .emergencyStopActive)
    }
}
