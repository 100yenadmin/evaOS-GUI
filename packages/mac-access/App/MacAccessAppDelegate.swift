import AppKit
import MacAccessShared
import ServiceManagement

enum MacAccessLoginItemState: Equatable {
    case notRegistered
    case enabled
    case requiresApproval
    case notFound
    case unavailable
    case failed
}

@MainActor
protocol MacAccessLoginItemServicing: AnyObject {
    var state: MacAccessLoginItemState { get }
    func register() throws
    func unregister() async throws
}

@MainActor
final class SystemMacAccessLoginItemService: MacAccessLoginItemServicing {
    // The macOS 15 SDK does not annotate SMAppService as Sendable even though
    // its async unregister API is the supported wait-for-termination path.
    nonisolated(unsafe) private let service = SMAppService.loginItem(
        identifier: MacAccessIdentity.connectorServiceID
    )

    var state: MacAccessLoginItemState {
        switch service.status {
        case .notRegistered: .notRegistered
        case .enabled: .enabled
        case .requiresApproval: .requiresApproval
        case .notFound: .notFound
        @unknown default: .unavailable
        }
    }

    func register() throws {
        try service.register()
    }

    func unregister() async throws {
        try await service.unregister()
    }
}

@MainActor
final class MacAccessAppDelegate: NSObject, NSApplicationDelegate {
    weak var controller: MacAccessController?
    private(set) var loginItemState: MacAccessLoginItemState

    private let loginItemService: any MacAccessLoginItemServicing
    private var terminationReplyPending = false
    private var terminationAuthorized = false

    override convenience init() {
        self.init(loginItemService: SystemMacAccessLoginItemService())
    }

    init(loginItemService: any MacAccessLoginItemServicing) {
        self.loginItemService = loginItemService
        loginItemState = loginItemService.state
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        #if !DEBUG
        registerLoginItemIfNeeded()
        #endif
    }

    @discardableResult
    func registerLoginItemIfNeeded() -> MacAccessLoginItemState {
        switch loginItemService.state {
        case .notRegistered:
            do {
                try loginItemService.register()
                loginItemState = loginItemService.state
            } catch {
                loginItemState = .failed
            }
        case let state:
            loginItemState = state
        }
        return loginItemState
    }

    func prepareForUninstall() async -> Bool {
        guard let controller,
              await controller.perform(.revokeSelectedVM) == .completed(.revoked)
        else { return false }

        switch loginItemService.state {
        case .notRegistered:
            terminationAuthorized = true
            loginItemState = loginItemService.state
            return true
        case .enabled, .requiresApproval, .notFound, .unavailable, .failed:
            do {
                try await loginItemService.unregister()
                loginItemState = loginItemService.state
                guard loginItemState == .notRegistered else {
                    return false
                }
                terminationAuthorized = true
                return true
            } catch {
                loginItemState = .failed
                return false
            }
        }
    }

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
