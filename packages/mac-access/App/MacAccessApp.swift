import AppKit
import Darwin
import MacAccessShared
import SwiftUI

@main
enum MacAccessEntryPoint {
    @MainActor
    static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard MacAccessCLI.shouldRun(arguments: arguments) else {
            MacAccessApp.main()
            return
        }

        Task { @MainActor in
            let stdin = MacAccessCLI.parse(arguments: arguments) == .pair
                ? FileHandle.standardInput.readDataToEndOfFile()
                : Data()
            var execution = MacAccessLocalControl.request(
                arguments: arguments, stdin: stdin
            )
            if execution == nil {
                let configuration = NSWorkspace.OpenConfiguration()
                configuration.activates = false
                _ = try? await NSWorkspace.shared.openApplication(
                    at: Bundle.main.bundleURL,
                    configuration: configuration
                )
                for _ in 0..<20 where execution == nil {
                    try? await Task.sleep(for: .milliseconds(100))
                    execution = MacAccessLocalControl.request(
                        arguments: arguments, stdin: stdin
                    )
                }
            }
            let result = execution ?? MacAccessCLI.appUnavailable(arguments: arguments)
            let output = result.standardError ? FileHandle.standardError : FileHandle.standardOutput
            output.write(result.output)
            Darwin.exit(result.exitCode)
        }
        RunLoop.main.run()
    }
}

struct MacAccessApp: App {
    @StateObject private var controller: MacAccessController
    @StateObject private var onboardingWindow: MacAccessOnboardingWindow
    private let localControlServer: MacAccessLocalControlServer

    init() {
        let client = MacAccessXPCConnectorCoreClient()
        let controller = MacAccessController(
            client: client,
            availability: .internalAlpha
        )
        let onboardingWindow = MacAccessOnboardingWindow()
        _controller = StateObject(wrappedValue: controller)
        _onboardingWindow = StateObject(wrappedValue: onboardingWindow)
        localControlServer = MacAccessLocalControlServer(
            client: MacAccessControllerCLIClient(
                controller: controller,
                statusClient: client
            ),
            showSetup: {
                onboardingWindow.show(controller: controller)
            }
        )
        localControlServer.start()
    }

    var body: some Scene {
        MenuBarExtra {
            MacAccessMenu(
                controller: controller,
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
            .task {
                await controller.refreshFromHelper()
            }
        }
        .menuBarExtraStyle(.menu)
    }
}

extension MacAccessMode {
    var localizationKey: LocalizedStringKey {
        switch self {
        case .off: "mode.off"
        case .fullAccess: "mode.fullAccess"
        }
    }
}

extension MacAccessConnectionState {
    var localizationKey: LocalizedStringKey {
        switch self {
        case .disconnected: "status.disconnected"
        case .connecting: "status.connecting"
        case .connected: "status.connected"
        case .paused: "status.paused"
        case .blocked: "status.blocked"
        }
    }

    var symbolName: String {
        switch self {
        case .disconnected: "bolt.slash.fill"
        case .connecting: "arrow.triangle.2.circlepath"
        case .connected: "checkmark.shield.fill"
        case .paused: "pause.circle.fill"
        case .blocked: "exclamationmark.shield.fill"
        }
    }
}
