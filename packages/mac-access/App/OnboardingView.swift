import AppKit
import MacAccessShared
import SwiftUI

@MainActor
final class MacAccessOnboardingWindow: ObservableObject {
    private var windowController: NSWindowController?

    func show(controller: MacAccessController) {
        if let window = windowController?.window {
            NSApplication.shared.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            return
        }

        let content = NSHostingController(
            rootView: OnboardingView(
                controller: controller,
                close: { [weak self] in self?.close() }
            )
        )
        let window = NSWindow(contentViewController: content)
        window.title = String(localized: "onboarding.title")
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.center()

        let windowController = NSWindowController(window: window)
        self.windowController = windowController
        NSApplication.shared.setActivationPolicy(.accessory)
        NSApplication.shared.activate(ignoringOtherApps: true)
        windowController.showWindow(nil)
        window.makeKeyAndOrderFront(nil)
    }

    func close() {
        windowController?.close()
    }
}

struct OnboardingView: View {
    @ObservedObject var controller: MacAccessController
    let close: () -> Void
    @State private var pairingCode = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("onboarding.title", systemImage: "lock.shield")
                .font(.title2)

            Text("onboarding.backendBlocked")

            TextField("onboarding.pairingCode", text: $pairingCode)
                .textFieldStyle(.roundedBorder)
                .onChange(of: pairingCode) { _, value in
                    pairingCode = String(value.uppercased().prefix(12))
                }

            GroupBox("onboarding.identityTitle") {
                VStack(alignment: .leading, spacing: 6) {
                    Text("onboarding.expectedExecutable")
                    Text(verbatim: "/Applications/evaOS Mac Access.app/Contents/MacOS/evaOS Mac Access")
                        .font(.system(.body, design: .monospaced))
                    Text("onboarding.expectedBundle")
                    Text(verbatim: MacAccessIdentity.appBundleID)
                        .font(.system(.body, design: .monospaced))
                    Text("onboarding.helperInvoker")
                    Text(
                        verbatim:
                            "/Applications/evaOS Mac Access.app/Contents/XPCServices/evaOS Mac Access Helper.xpc/Contents/MacOS/evaOS Mac Access Helper"
                    )
                        .font(.system(.body, design: .monospaced))
                    Text(verbatim: MacAccessIdentity.helperServiceID)
                        .font(.system(.caption, design: .monospaced))
                    Text("onboarding.designatedRequirement")
                    Text(verbatim: MacAccessIdentity.appDesignatedRequirement)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                    Text("onboarding.permissionWarning")
                        .font(.caption)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Text("onboarding.noSecrets")
                .font(.caption)

            GroupBox("action.permissions") {
                VStack(alignment: .leading, spacing: 8) {
                    permissionRow(.accessibility, title: "permission.accessibility")
                    permissionRow(.screenRecording, title: "permission.screenRecording")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack {
                Button("action.pair") {
                    Task { await controller.perform(.pair(pairingCode)) }
                }
                .disabled(!controller.availability.pairing || pairingCode.count != 12)
                .keyboardShortcut(.defaultAction)
                Spacer()
                Button("action.close") {
                    close()
                }
                .keyboardShortcut(.cancelAction)
            }
        }
        .padding(24)
        .frame(width: 520)
        .task {
            await controller.refreshFromHelper()
        }
    }

    private func permissionRow(
        _ kind: MacAccessPermissionKind,
        title: LocalizedStringKey
    ) -> some View {
        HStack {
            Image(systemName: permissionState(kind) == .granted ? "checkmark.circle.fill" : "circle")
            Text(title)
            Spacer()
            Button(title) {
                Task { await controller.requestPermission(kind) }
            }
        }
    }

    private func permissionState(_ kind: MacAccessPermissionKind) -> MacAccessPermissionState {
        switch kind {
        case .accessibility: controller.permissions.accessibility
        case .screenRecording: controller.permissions.screenRecording
        }
    }
}
