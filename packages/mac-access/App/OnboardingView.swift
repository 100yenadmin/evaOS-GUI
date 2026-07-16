import MacAccessShared
import SwiftUI

struct OnboardingView: View {
    @ObservedObject var controller: MacAccessController
    @Environment(\.dismissWindow) private var dismissWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("onboarding.title", systemImage: "lock.shield")
                .font(.title2)

            Text("onboarding.backendBlocked")

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

            HStack {
                Button("action.pair") {
                    Task { await controller.perform(.pair) }
                }
                .disabled(!controller.availability.pairing)
                Spacer()
                Button("action.close") {
                    dismissWindow(id: "onboarding")
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 520)
    }
}
