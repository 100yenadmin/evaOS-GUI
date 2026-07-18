import AppKit
import Darwin
import MacAccessShared
import SwiftUI

final class MacAccessApprovalHandler: NSObject, MacAccessXPCApprovalProtocol, @unchecked Sendable {
    func requestApproval(
        _ data: Data,
        withReply reply: @escaping @Sendable (Data) -> Void
    ) {
        Task { @MainActor in
            guard data.count <= 4 << 10,
                  let request = try? JSONDecoder().decode(MacAccessApprovalRequest.self, from: data)
            else {
                reply(Data())
                return
            }
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = String(localized: "approval.title")
            alert.informativeText = [
                request.actionSummary,
                request.capability,
                String(request.requestDigestSHA256.prefix(16)),
            ].joined(separator: "\n")
            alert.addButton(withTitle: String(localized: "approval.allowOnce"))
            alert.addButton(withTitle: String(localized: "approval.deny"))
            NSApplication.shared.activate(ignoringOtherApps: true)
            let approved = alert.runModal() == .alertFirstButtonReturn
            let response = MacAccessApprovalReply(
                requestID: request.requestID,
                approved: approved
            )
            reply((try? JSONEncoder().encode(response)) ?? Data())
        }
    }
}

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
    private static let approvalHandler = MacAccessApprovalHandler()
    @StateObject private var controller: MacAccessController
    @StateObject private var onboardingWindow: MacAccessOnboardingWindow
    private let localControlServer: MacAccessLocalControlServer

    init() {
        let client = MacAccessXPCConnectorCoreClient(
            approvalHandler: Self.approvalHandler
        )
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
