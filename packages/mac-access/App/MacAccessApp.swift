import AppKit
import MacAccessShared
import SwiftUI

@main
struct MacAccessApp: App {
    @NSApplicationDelegateAdaptor(MacAccessAppDelegate.self) private var appDelegate
    @StateObject private var controller: MacAccessController
    @StateObject private var updater: MacAccessUpdater
    @StateObject private var onboardingWindow = MacAccessOnboardingWindow()

    init() {
        let controller = MacAccessController(
            client: MacAccessXPCConnectorCoreClient(),
            availability: .standalonePolicy
        )
        _controller = StateObject(wrappedValue: controller)
        _updater = StateObject(wrappedValue: MacAccessUpdater(controller: controller))
        appDelegate.controller = controller
    }

    var body: some Scene {
        MenuBarExtra {
            MacAccessMenu(
                controller: controller,
                updater: updater,
                showOnboarding: { onboardingWindow.show(controller: controller) }
            )
        } label: {
            Label {
                Text(controller.state.connection.localizationKey)
            } icon: {
                Image(systemName: controller.state.connection.symbolName)
            }
            .accessibilityLabel(
                Text(verbatim: "evaOS Mac Access, ")
                    + Text(controller.state.connection.localizationKey)
                    + Text(verbatim: ", ")
                    + Text(controller.state.effectiveMode.localizationKey)
            )
        }
        .menuBarExtraStyle(.menu)
    }
}

extension MacAccessMode {
    var localizationKey: LocalizedStringKey {
        switch self {
        case .off: "mode.off"
        case .askEveryTime: "mode.askEveryTime"
        case .fullAccess: "mode.fullAccess"
        }
    }
}

extension MacAccessConnectionState {
    var localizationKey: LocalizedStringKey {
        switch self {
        case .disconnected: "status.disconnected"
        case .connecting: "status.connecting"
        case .approvalNeeded: "status.approvalNeeded"
        case .connected: "status.connected"
        case .paused: "status.paused"
        case .blocked: "status.blocked"
        }
    }

    var symbolName: String {
        switch self {
        case .disconnected: "bolt.slash.fill"
        case .connecting: "arrow.triangle.2.circlepath"
        case .approvalNeeded: "hand.raised.fill"
        case .connected: "checkmark.shield.fill"
        case .paused: "pause.circle.fill"
        case .blocked: "exclamationmark.shield.fill"
        }
    }
}
