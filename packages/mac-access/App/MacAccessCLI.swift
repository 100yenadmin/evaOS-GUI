import AppKit
import Foundation
import MacAccessShared

enum MacAccessSetupRequest {
    static let notification = Notification.Name("com.evaos.mac-access.setup.request")

    @MainActor
    static func open(bundleURL: URL = Bundle.main.bundleURL) async -> Bool {
        let currentPID = ProcessInfo.processInfo.processIdentifier
        let runningApp = NSRunningApplication.runningApplications(
            withBundleIdentifier: MacAccessIdentity.appBundleID
        ).first { application in
            application.processIdentifier != currentPID && !application.isTerminated
        }

        if runningApp == nil {
            do {
                try NSWorkspace.shared.launchApplication(
                    at: bundleURL,
                    options: [.newInstance],
                    configuration: [:]
                )
                try await Task.sleep(for: .milliseconds(500))
            } catch {
                return false
            }
        }

        DistributedNotificationCenter.default().postNotificationName(
            notification,
            object: nil,
            userInfo: nil,
            deliverImmediately: true
        )
        return true
    }
}

enum MacAccessCLICommand: Equatable {
    case setup
    case status
    case pairFromStdin
    case connect
    case disconnect
    case accessMode(MacAccessMode)
    case pause
    case resume
    case stop
    case revoke
    case emergencyStop
    case approvalShow
    case approvalApprove(String)
    case approvalDeny(String)
    case audit
    case diagnostics
    case version
    case help

    var name: String {
        switch self {
        case .setup: "setup"
        case .status: "status"
        case .pairFromStdin: "pair"
        case .connect: "connect"
        case .disconnect: "disconnect"
        case .accessMode: "access-mode"
        case .pause: "pause"
        case .resume: "resume"
        case .stop: "stop"
        case .revoke: "revoke"
        case .emergencyStop: "emergency-stop"
        case .approvalShow: "approval-show"
        case .approvalApprove: "approval-approve"
        case .approvalDeny: "approval-deny"
        case .audit: "audit"
        case .diagnostics: "diagnostics"
        case .version: "version"
        case .help: "help"
        }
    }
}

enum MacAccessCLIParseError: Error {
    case usage
}

struct MacAccessCLIBuildInfo: Encodable, Equatable {
    let marketingVersion: String
    let buildVersion: String
    let sourceCommit: String

    static func production(bundle: Bundle = .main) -> Self {
        Self(
            marketingVersion: value("CFBundleShortVersionString", in: bundle),
            buildVersion: value("CFBundleVersion", in: bundle),
            sourceCommit: value("MacAccessSourceCommit", in: bundle)
        )
    }

    private static func value(_ key: String, in bundle: Bundle) -> String {
        let value = bundle.object(forInfoDictionaryKey: key) as? String
        return value?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? "unknown"
    }
}

struct MacAccessCLIIdentityInfo: Encodable, Equatable {
    let teamID = MacAccessIdentity.teamID
    let appBundleID = MacAccessIdentity.appBundleID
    let helperServiceID = MacAccessIdentity.helperServiceID
    let connectorServiceID = MacAccessIdentity.connectorServiceID
    let appRequirementSHA256 = MacAccessIdentity.appDesignatedRequirementSHA256
    let helperRequirementSHA256 = MacAccessIdentity.helperDesignatedRequirementSHA256
    let connectorRequirementSHA256 = MacAccessIdentity.connectorDesignatedRequirementSHA256
}

struct MacAccessCLIEnvelope: Encodable {
    let schemaVersion = "evaos.mac_access.cli_response.v1"
    let ok: Bool
    let command: String
    let resultCode: String
    let status: MacAccessXPCSafeStatus?
    let pendingApproval: MacAccessXPCPendingApproval?
    let auditEventCount: Int?
    let recentAuditEvents: [MacAccessXPCAuditEvent]?
    let identity: MacAccessCLIIdentityInfo?
    let build: MacAccessCLIBuildInfo?

    init(
        ok: Bool,
        command: String,
        resultCode: String,
        status: MacAccessXPCSafeStatus? = nil,
        pendingApproval: MacAccessXPCPendingApproval? = nil,
        auditEventCount: Int? = nil,
        recentAuditEvents: [MacAccessXPCAuditEvent]? = nil,
        identity: MacAccessCLIIdentityInfo? = nil,
        build: MacAccessCLIBuildInfo? = nil
    ) {
        self.ok = ok
        self.command = command
        self.resultCode = resultCode
        self.status = status
        self.pendingApproval = pendingApproval
        self.auditEventCount = auditEventCount
        self.recentAuditEvents = recentAuditEvents
        self.identity = identity
        self.build = build
    }
}

struct MacAccessCLIExecution {
    let exitCode: Int32
    let output: Data
    let writesToStandardError: Bool
}

enum MacAccessCLI {
    static let usage = """
    evaOS Mac Access local CLI

    Usage:
      "/Applications/evaOS Mac Access.app/Contents/MacOS/evaOS Mac Access" <command> [--json]

    Commands:
      setup
      status
      pair --code-stdin
      connect | disconnect
      access-mode off|ask-every-time|full-access
      pause | resume | stop | revoke | emergency-stop
      approval show
      approval approve <command-id>
      approval deny <command-id>
      audit | diagnostics | version | help

    Remote evaOS VM agents use the broker-selected CUA path, not this local CLI.
    Pairing codes are accepted only from stdin and are never printed.
    """

    private static let exitUsage: Int32 = 64
    private static let exitDataError: Int32 = 65
    private static let exitUnavailable: Int32 = 69
    private static let exitBlocked: Int32 = 77

    static func shouldRun(arguments: [String]) -> Bool {
        guard let first = arguments.first else { return false }
        return !(
            first.hasPrefix("-psn_")
                || first.hasPrefix("-NS")
                || first.hasPrefix("-Apple")
        )
    }

    static func parse(arguments: [String]) throws -> MacAccessCLICommand {
        var arguments = arguments
        if arguments.first == "--cli" {
            arguments.removeFirst()
        }
        guard arguments.filter({ $0 == "--json" }).count <= 1 else {
            throw MacAccessCLIParseError.usage
        }
        arguments.removeAll { $0 == "--json" }
        guard let command = arguments.first else {
            throw MacAccessCLIParseError.usage
        }

        switch command {
        case "setup" where arguments.count == 1:
            return .setup
        case "status" where arguments.count == 1:
            return .status
        case "pair" where arguments == ["pair", "--code-stdin"]:
            return .pairFromStdin
        case "connect" where arguments.count == 1:
            return .connect
        case "disconnect" where arguments.count == 1:
            return .disconnect
        case "access-mode" where arguments.count == 2:
            switch arguments[1] {
            case "off": return .accessMode(.off)
            case "ask-every-time": return .accessMode(.askEveryTime)
            case "full-access": return .accessMode(.fullAccess)
            default: throw MacAccessCLIParseError.usage
            }
        case "pause" where arguments.count == 1:
            return .pause
        case "resume" where arguments.count == 1:
            return .resume
        case "stop" where arguments.count == 1:
            return .stop
        case "revoke" where arguments.count == 1:
            return .revoke
        case "emergency-stop" where arguments.count == 1:
            return .emergencyStop
        case "approval" where arguments == ["approval", "show"]:
            return .approvalShow
        case "approval" where arguments.count == 3 && arguments[1] == "approve":
            return .approvalApprove(try commandID(arguments[2]))
        case "approval" where arguments.count == 3 && arguments[1] == "deny":
            return .approvalDeny(try commandID(arguments[2]))
        case "audit" where arguments.count == 1:
            return .audit
        case "diagnostics" where arguments.count == 1:
            return .diagnostics
        case "version" where arguments.count == 1:
            return .version
        case "--version" where arguments.count == 1:
            return .version
        case "help" where arguments.count == 1:
            return .help
        case "--help" where arguments.count == 1:
            return .help
        case "-h" where arguments.count == 1:
            return .help
        default:
            throw MacAccessCLIParseError.usage
        }
    }

    static func execute(
        arguments: [String],
        client: any MacAccessStatusProjectingClient,
        build: MacAccessCLIBuildInfo = .production(),
        readStdin: @Sendable () throws -> Data,
        openSetup: @MainActor () async -> Bool = {
            await MacAccessSetupRequest.open()
        }
    ) async -> MacAccessCLIExecution {
        let command: MacAccessCLICommand
        do {
            command = try parse(arguments: arguments)
        } catch {
            return encoded(
                MacAccessCLIEnvelope(ok: false, command: "unknown", resultCode: "usage_error"),
                exitCode: exitUsage,
                standardError: true
            )
        }

        switch command {
        case .setup:
            let opened = await openSetup()
            return encoded(
                MacAccessCLIEnvelope(
                    ok: opened,
                    command: command.name,
                    resultCode: opened ? "setup_opened" : "setup_unavailable"
                ),
                exitCode: opened ? 0 : exitUnavailable,
                standardError: !opened
            )
        case .help:
            return MacAccessCLIExecution(
                exitCode: 0,
                output: Data((usage + "\n").utf8),
                writesToStandardError: false
            )
        case .version:
            return encoded(
                MacAccessCLIEnvelope(
                    ok: true,
                    command: command.name,
                    resultCode: "ok",
                    identity: MacAccessCLIIdentityInfo(),
                    build: build
                ),
                exitCode: 0
            )
        case .status:
            return await statusExecution(command: command.name, client: client)
        case .pairFromStdin:
            let input: Data
            do {
                input = try readStdin()
            } catch {
                return encoded(
                    MacAccessCLIEnvelope(
                        ok: false,
                        command: command.name,
                        resultCode: "stdin_unavailable"
                    ),
                    exitCode: exitDataError,
                    standardError: true
                )
            }
            guard input.count <= 64, var code = String(data: input, encoding: .utf8) else {
                return encoded(
                    MacAccessCLIEnvelope(
                        ok: false,
                        command: command.name,
                        resultCode: "invalid_pairing_code"
                    ),
                    exitCode: exitDataError,
                    standardError: true
                )
            }
            code = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            let execution = await actionExecution(
                command: command.name,
                action: .pair(code),
                client: client
            )
            code.removeAll(keepingCapacity: false)
            return execution
        case .connect:
            return await actionExecution(command: command.name, action: .connect, client: client)
        case .disconnect:
            return await actionExecution(command: command.name, action: .disconnect, client: client)
        case .accessMode(let mode):
            return await actionExecution(
                command: command.name,
                action: .setAccessMode(mode),
                client: client
            )
        case .pause:
            return await actionExecution(command: command.name, action: .pause, client: client)
        case .resume:
            return await actionExecution(command: command.name, action: .resume, client: client)
        case .stop:
            return await actionExecution(command: command.name, action: .stop, client: client)
        case .revoke:
            return await actionExecution(
                command: command.name,
                action: .revokeSelectedVM,
                client: client
            )
        case .emergencyStop:
            return await actionExecution(
                command: command.name,
                action: .activateKillSwitch,
                client: client
            )
        case .approvalShow:
            return await approvalShowExecution(command: command.name, client: client)
        case .approvalApprove(let commandID):
            return await approvalExecution(
                command: command.name,
                commandID: commandID,
                allow: true,
                client: client
            )
        case .approvalDeny(let commandID):
            return await approvalExecution(
                command: command.name,
                commandID: commandID,
                allow: false,
                client: client
            )
        case .audit:
            return await auditExecution(command: command.name, client: client)
        case .diagnostics:
            return await diagnosticsExecution(command: command.name, client: client, build: build)
        }
    }

    private static func statusExecution(
        command: String,
        client: any MacAccessStatusProjectingClient
    ) async -> MacAccessCLIExecution {
        guard let reply = await client.fetchStatus() else {
            return unavailable(command: command)
        }
        return encoded(
            MacAccessCLIEnvelope(
                ok: reply.code == .ok,
                command: command,
                resultCode: reply.code.rawValue,
                status: reply.status
            ),
            exitCode: reply.code == .ok ? 0 : exitBlocked,
            standardError: reply.code != .ok
        )
    }

    private static func actionExecution(
        command: String,
        action: ConnectorCoreAction,
        client: any MacAccessStatusProjectingClient
    ) async -> MacAccessCLIExecution {
        let result = await client.perform(action)
        let status = await client.fetchStatus()?.status
        switch result {
        case .completed(let completion):
            return encoded(
                MacAccessCLIEnvelope(
                    ok: true,
                    command: command,
                    resultCode: completion.cliValue,
                    status: status
                ),
                exitCode: 0
            )
        case .blocked(let blocker):
            return encoded(
                MacAccessCLIEnvelope(
                    ok: false,
                    command: command,
                    resultCode: blocker.cliValue,
                    status: status
                ),
                exitCode: exitBlocked,
                standardError: true
            )
        }
    }

    private static func approvalShowExecution(
        command: String,
        client: any MacAccessStatusProjectingClient
    ) async -> MacAccessCLIExecution {
        guard let reply = await client.fetchStatus() else {
            return unavailable(command: command)
        }
        guard let pending = reply.status.pendingApproval else {
            return encoded(
                MacAccessCLIEnvelope(
                    ok: false,
                    command: command,
                    resultCode: "no_pending_approval",
                    status: reply.status
                ),
                exitCode: exitDataError,
                standardError: true
            )
        }
        return encoded(
            MacAccessCLIEnvelope(
                ok: true,
                command: command,
                resultCode: "pending_approval",
                pendingApproval: pending
            ),
            exitCode: 0
        )
    }

    private static func approvalExecution(
        command: String,
        commandID: String,
        allow: Bool,
        client: any MacAccessStatusProjectingClient
    ) async -> MacAccessCLIExecution {
        guard let current = await client.fetchStatus() else {
            return unavailable(command: command)
        }
        guard let pending = current.status.pendingApproval,
              pending.approval.commandID == commandID
        else {
            return encoded(
                MacAccessCLIEnvelope(
                    ok: false,
                    command: command,
                    resultCode: "pending_approval_mismatch",
                    status: current.status
                ),
                exitCode: exitDataError,
                standardError: true
            )
        }
        guard let reply = await client.resolvePendingApproval(
            pending.approval,
            allow: allow
        ) else {
            return unavailable(command: command)
        }
        let accepted = reply.code == .ok
        return encoded(
            MacAccessCLIEnvelope(
                ok: accepted,
                command: command,
                resultCode: accepted ? (allow ? "approved" : "denied") : reply.code.rawValue,
                status: reply.status
            ),
            exitCode: accepted ? 0 : exitBlocked,
            standardError: !accepted
        )
    }

    private static func auditExecution(
        command: String,
        client: any MacAccessStatusProjectingClient
    ) async -> MacAccessCLIExecution {
        guard let reply = await client.fetchStatus() else {
            return unavailable(command: command)
        }
        return encoded(
            MacAccessCLIEnvelope(
                ok: reply.code == .ok,
                command: command,
                resultCode: reply.code.rawValue,
                auditEventCount: reply.status.auditEventCount,
                recentAuditEvents: reply.status.recentAuditEvents
            ),
            exitCode: reply.code == .ok ? 0 : exitBlocked,
            standardError: reply.code != .ok
        )
    }

    private static func diagnosticsExecution(
        command: String,
        client: any MacAccessStatusProjectingClient,
        build: MacAccessCLIBuildInfo
    ) async -> MacAccessCLIExecution {
        let reply = await client.fetchStatus()
        return encoded(
            MacAccessCLIEnvelope(
                ok: reply?.code == .ok,
                command: command,
                resultCode: reply?.code.rawValue ?? "helper_unavailable",
                status: reply?.status,
                identity: MacAccessCLIIdentityInfo(),
                build: build
            ),
            exitCode: reply == nil ? exitUnavailable : (reply?.code == .ok ? 0 : exitBlocked),
            standardError: reply?.code != .ok
        )
    }

    private static func unavailable(command: String) -> MacAccessCLIExecution {
        encoded(
            MacAccessCLIEnvelope(
                ok: false,
                command: command,
                resultCode: "helper_unavailable"
            ),
            exitCode: exitUnavailable,
            standardError: true
        )
    }

    private static func encoded(
        _ envelope: MacAccessCLIEnvelope,
        exitCode: Int32,
        standardError: Bool = false
    ) -> MacAccessCLIExecution {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var output = (try? encoder.encode(envelope))
            ?? Data(#"{"command":"unknown","ok":false,"result_code":"encoding_failed","schema_version":"evaos.mac_access.cli_response.v1"}"#.utf8)
        output.append(0x0A)
        return MacAccessCLIExecution(
            exitCode: exitCode,
            output: output,
            writesToStandardError: standardError
        )
    }

    private static func commandID(_ value: String) throws -> String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, normalized.utf8.count <= 128 else {
            throw MacAccessCLIParseError.usage
        }
        return normalized
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}

private extension ConnectorCoreCompletion {
    var cliValue: String {
        switch self {
        case .paired: "paired"
        case .unpaired: "unpaired"
        case .connected: "connected"
        case .disconnected: "disconnected"
        case .revoked: "revoked"
        case .localStop: "stopped"
        case .localPause: "paused"
        case .localResume: "resumed"
        case .localEmergencyStop: "emergency_stopped"
        case .localEmergencyReset: "emergency_reset"
        case .accessModeChanged(.off): "access_mode_off"
        case .accessModeChanged(.askEveryTime): "access_mode_ask_every_time"
        case .accessModeChanged(.fullAccess): "access_mode_full_access"
        }
    }
}

private extension MacAccessBlocker {
    var cliValue: String {
        switch self {
        case .notPaired: "not_paired"
        case .invalidPairingCode: "invalid_pairing_code"
        case .pairingRejected: "pairing_rejected"
        case .credentialUnavailable: "credential_unavailable"
        case .policyUnavailable: "policy_unavailable"
        case .dashboardPairingUnavailable: "configuration_unavailable"
        case .relayUnavailable: "relay_unavailable"
        case .connectorCoreUnavailable: "connector_core_unavailable"
        case .emergencyStopActive: "emergency_stop_active"
        case .permissionProofPending: "permission_proof_pending"
        case .permissionDenied: "permission_denied"
        case .stalePairing: "stale_pairing"
        case .revokedGrant: "revoked"
        case .offlineBroker: "offline_broker"
        case .coreCrashed: "core_crashed"
        case .updateRequired: "update_required"
        case .conflictingWorkbenchOwner: "conflicting_workbench_owner"
        }
    }
}
