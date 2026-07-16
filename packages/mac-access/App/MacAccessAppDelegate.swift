import AppKit
import MacAccessShared

@MainActor
final class MacAccessAppDelegate: NSObject, NSApplicationDelegate {
    weak var controller: MacAccessController?

    private var terminationReplyPending = false
    private var terminationAuthorized = false

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if terminationAuthorized {
            return .terminateNow
        }
        guard let controller, !terminationReplyPending else {
            return .terminateLater
        }

        terminationReplyPending = true
        Task { @MainActor [weak self, weak sender] in
            let result = await controller.prepareToQuit()
            guard let self else { return }
            terminationReplyPending = false
            terminationAuthorized = result == .completed(.localStop)
            sender?.reply(toApplicationShouldTerminate: terminationAuthorized)
        }
        return .terminateLater
    }
}
