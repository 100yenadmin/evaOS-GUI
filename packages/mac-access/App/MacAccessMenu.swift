import AppKit
import MacAccessShared
import SwiftUI

struct MacAccessMenu: View {
    @ObservedObject var controller: MacAccessController
    let showOnboarding: () -> Void

    var body: some View {
        Text(controller.state.connection.localizationKey)
            .font(.headline)
            .task {
                while !Task.isCancelled {
                    await controller.refreshFromHelper()
                    try? await Task.sleep(for: .seconds(1))
                }
            }
        Text(blockerKey)
            .font(.caption)
        HStack {
            Text("action.accessMode")
            Spacer()
            Text(controller.state.effectiveMode.localizationKey)
        }
        .accessibilityElement(children: .combine)

        if let pending = controller.pendingApproval {
            Divider()
            Text("status.approvalNeeded")
                .font(.headline)
            Text(verbatim: pending.approval.capability)
                .font(.caption)
            HStack {
                Button {
                    Task { await controller.resolvePendingApproval(allow: true) }
                } label: {
                    Text(verbatim: "Allow once")
                }
                Button(role: .destructive) {
                    Task { await controller.resolvePendingApproval(allow: false) }
                } label: {
                    Text(verbatim: "Deny")
                }
            }
        }

        Divider()

        Button("onboarding.title") {
            showOnboarding()
        }
        .keyboardShortcut("p")

        Button("action.unpair") {
            Task { await controller.perform(.unpair) }
        }
            .disabled(!controller.availability.pairing)

        Button("action.connect") {
            Task { await controller.perform(.connect) }
        }
            .disabled(!controller.canConnect)

        Button("action.disconnect") {
            Task { await controller.perform(.disconnect) }
        }
            .disabled(!controller.availability.transport)

        Menu("action.accessMode") {
            accessModeButton(.off)
            accessModeButton(.askEveryTime)
                .disabled(!controller.availability.elevatedAccessModes)
            accessModeButton(.fullAccess)
                .disabled(!controller.availability.elevatedAccessModes)
        }

        Menu("action.permissions") {
            Button("permission.accessibility") {}
                .disabled(true)
                .help("blocker.permissionProofPending")
            Button("permission.screenRecording") {}
                .disabled(true)
                .help("blocker.permissionProofPending")
        }

        Menu("action.lastActivity") {
            if controller.recentAuditEvents.isEmpty {
                Text("activity.none")
            } else {
                ForEach(Array(controller.recentAuditEvents.enumerated()), id: \.offset) { _, event in
                    VStack(alignment: .leading) {
                        Text(verbatim: "\(event.capability): \(event.outcome)")
                        Text(event.occurredAt, style: .relative)
                            .font(.caption)
                    }
                }
            }
        }

        Button("action.pause") {
            Task { await controller.perform(.pause) }
        }
        .disabled(!controller.state.isPaired || controller.state.connection != .connected)

        Button("action.resume") {
            Task { await controller.perform(.resume) }
        }
        .disabled(!controller.state.isPaired || controller.state.connection != .paused)

        Button("action.revokeSelectedVM") {
            Task { await controller.perform(.revokeSelectedVM) }
        }
            .disabled(!controller.availability.revoke)

        Button("action.emergencyStop", role: .destructive) {
            controller.emergencyStop()
        }
        .keyboardShortcut(".", modifiers: [.command, .shift])

        if controller.state.blocker == .emergencyStopActive {
            Button {
                Task { await controller.perform(.clearKillSwitch) }
            } label: {
                Text(verbatim: "Reset and re-pair")
            }
        }

        Button("action.diagnostics") {}
            .disabled(true)
            .help("blocker.coreUnavailable")

        Button("action.update") {}
            .disabled(!controller.availability.update)

        Divider()

        Button("action.quit") {
            Task {
                let result = await controller.prepareToQuit()
                if result == .completed(.localStop) {
                    NSApplication.shared.terminate(nil)
                }
            }
        }
        .keyboardShortcut("q")
    }

    private var blockerKey: LocalizedStringKey {
        switch controller.state.blocker {
        case .notPaired: "blocker.notPaired"
        case .invalidPairingCode: "blocker.invalidPairingCode"
        case .pairingRejected: "blocker.pairingRejected"
        case .credentialUnavailable: "blocker.credentialUnavailable"
        case .policyUnavailable: "blocker.policyUnavailable"
        case .dashboardPairingUnavailable: "blocker.dashboardUnavailable"
        case .relayUnavailable: "blocker.relayUnavailable"
        case .connectorCoreUnavailable: "blocker.coreUnavailable"
        case .emergencyStopActive: "blocker.emergencyStop"
        case .permissionProofPending: "blocker.permissionProofPending"
        case .permissionDenied: "blocker.permissionDenied"
        case .stalePairing: "blocker.stalePairing"
        case .revokedGrant: "blocker.revokedGrant"
        case .offlineBroker: "blocker.offlineBroker"
        case .coreCrashed: "blocker.coreCrashed"
        case .updateRequired: "blocker.updateRequired"
        case .conflictingWorkbenchOwner: "blocker.conflictingWorkbenchOwner"
        case nil: "blocker.none"
        }
    }

    private func accessModeButton(_ mode: MacAccessMode) -> some View {
        Button {
            Task { await controller.perform(.setAccessMode(mode)) }
        } label: {
            Label(mode.localizationKey, systemImage: controller.state.configuredMode == mode ? "checkmark" : "circle")
        }
        .accessibilityAddTraits(controller.state.configuredMode == mode ? .isSelected : [])
    }
}
