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

    func testConnectingWhileUnpairedFailsClosed() {
        var machine = MacAccessStateMachine()

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
