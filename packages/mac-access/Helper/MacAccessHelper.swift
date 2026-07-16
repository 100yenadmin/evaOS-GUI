import Foundation

@main
enum MacAccessHelperMain {
    static func main() {
        let delegate = MacAccessXPCListenerDelegate()
        let listener = NSXPCListener.service()
        listener.delegate = delegate
        listener.resume()
        withExtendedLifetime(delegate) {
            RunLoop.current.run()
        }
    }
}
