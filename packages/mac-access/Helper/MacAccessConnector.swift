import AppKit

@main
enum MacAccessConnectorMain {
    static func main() {
        // The nested login item is an inert identity placeholder in the local-only A2 slice.
        NSApplication.shared.setActivationPolicy(.prohibited)
        NSApplication.shared.run()
    }
}
