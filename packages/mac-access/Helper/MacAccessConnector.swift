import AppKit
import Darwin

@main
enum MacAccessConnectorMain {
    static func main() {
        guard let appURL = MacAccessConnectorPath.containingAppURL(
            connectorURL: Bundle.main.bundleURL
        ) else {
            exit(EXIT_SUCCESS)
        }

        NSApplication.shared.setActivationPolicy(.prohibited)
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        configuration.addsToRecentItems = false
        NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { _, _ in
            exit(EXIT_SUCCESS)
        }
        NSApplication.shared.run()
    }
}
