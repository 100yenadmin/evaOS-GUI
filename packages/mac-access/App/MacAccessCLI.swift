import Foundation
import MacAccessShared

protocol MacAccessCLIClient: MacAccessPermissionControllingClient {}

extension MacAccessXPCConnectorCoreClient: MacAccessCLIClient {}

enum MacAccessCLICommand: Equatable {
    case status, permissionStatus, requestAccessibility, requestScreenRecording
    case pair, connect, disconnect, stop, unpair, revoke, modeOff, modeAsk, modeFull, help

    var name: String {
        switch self {
        case .status: "status"
        case .permissionStatus: "permissions_status"
        case .requestAccessibility: "permissions_request_accessibility"
        case .requestScreenRecording: "permissions_request_screen_recording"
        case .pair: "pair"
        case .connect: "connect"
        case .disconnect: "disconnect"
        case .stop: "stop"
        case .revoke: "revoke"
        case .unpair: "unpair"
        case .modeOff: "mode_off"
        case .modeAsk: "mode_ask_every_time"
        case .modeFull: "mode_full_access"
        case .help: "help"
        }
    }
}

struct MacAccessCLIResponse: Encodable {
    let schemaVersion = "evaos.mac_access.cli_response.v1"
    let ok: Bool
    let command: String
    let resultCode: String
    let status: MacAccessXPCSafeStatus?

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case ok, command, status
        case resultCode = "result_code"
    }
}

struct MacAccessCLIExecution {
    let exitCode: Int32
    let output: Data
    let standardError: Bool
}

enum MacAccessCLI {
    static let usage = """
    evaOS Mac Access local CLI

    Usage:
      "/Applications/evaOS Mac Access.app/Contents/MacOS/evaOS Mac Access" <command> [--json]

    Commands:
      status
      permissions status
      permissions request accessibility
      permissions request screen-recording
      pair --code-stdin
      connect
      disconnect
      mode off
      mode ask
      mode full
      stop
      unpair
      revoke
      help

    Pairing codes are accepted only from stdin and are never printed.
    Remote agents use the broker-selected CUA path, not this local CLI.
    """

    static func shouldRun(arguments: [String]) -> Bool {
        guard let first = arguments.first else { return false }
        return !(first.hasPrefix("-psn_") || first.hasPrefix("-NS") || first.hasPrefix("-Apple"))
    }

    static func parse(arguments: [String]) -> MacAccessCLICommand? {
        let arguments = arguments.filter { $0 != "--json" }
        switch arguments {
        case ["status"]: return .status
        case ["permissions", "status"]: return .permissionStatus
        case ["permissions", "request", "accessibility"]: return .requestAccessibility
        case ["permissions", "request", "screen-recording"]: return .requestScreenRecording
        case ["pair", "--code-stdin"]: return .pair
        case ["connect"]: return .connect
        case ["disconnect"]: return .disconnect
        case ["mode", "off"]: return .modeOff
        case ["mode", "ask"]: return .modeAsk
        case ["mode", "full"]: return .modeFull
        case ["stop"]: return .stop
        case ["unpair"]: return .unpair
        case ["revoke"]: return .revoke
        case ["help"], ["--help"], ["-h"]: return .help
        default: return nil
        }
    }

    static func execute(
        arguments: [String],
        client: any MacAccessCLIClient,
        readStdin: @Sendable () throws -> Data
    ) async -> MacAccessCLIExecution {
        guard let command = parse(arguments: arguments) else {
            return response(
                ok: false, command: "unknown", resultCode: "usage_error",
                status: nil, exitCode: 64, standardError: true
            )
        }
        if command == .help {
            return MacAccessCLIExecution(
                exitCode: 0,
                output: Data((usage + "\n").utf8),
                standardError: false
            )
        }
        if command == .status || command == .permissionStatus {
            guard let reply = await client.fetchStatus() else {
                return response(
                    ok: false, command: command.name, resultCode: "helper_unavailable",
                    status: nil, exitCode: 69, standardError: true
                )
            }
            return response(
                ok: reply.code == .ok,
                command: command.name,
                resultCode: reply.code.rawValue,
                status: reply.status,
                exitCode: reply.code == .ok ? 0 : 77,
                standardError: reply.code != .ok
            )
        }
        if command == .requestAccessibility || command == .requestScreenRecording {
            let kind: MacAccessPermissionKind =
                command == .requestAccessibility ? .accessibility : .screenRecording
            guard let reply = await client.requestPermission(kind) else {
                return response(
                    ok: false, command: command.name, resultCode: "helper_unavailable",
                    status: nil, exitCode: 69, standardError: true
                )
            }
            return response(
                ok: reply.code == .ok,
                command: command.name,
                resultCode: reply.code.rawValue,
                status: reply.status,
                exitCode: reply.code == .ok ? 0 : 77,
                standardError: reply.code != .ok
            )
        }

        let action: ConnectorCoreAction
        switch command {
        case .pair:
            guard let input = try? readStdin(), input.count <= 64,
                  var code = String(data: input, encoding: .utf8)
            else {
                return response(
                    ok: false, command: command.name, resultCode: "invalid_pairing_code",
                    status: nil, exitCode: 65, standardError: true
                )
            }
            code = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            action = .pair(code)
            code.removeAll(keepingCapacity: false)
        case .connect: action = .connect
        case .disconnect: action = .disconnect
        case .stop: action = .stop
        case .unpair: action = .unpair
        case .revoke: action = .revokeSelectedVM
        case .modeOff: action = .setAccessMode(.off)
        case .modeAsk: action = .setAccessMode(.askEveryTime)
        case .modeFull: action = .setAccessMode(.fullAccess)
        case .status, .permissionStatus, .requestAccessibility, .requestScreenRecording, .help:
            preconditionFailure("status and help return before action dispatch")
        }

        let result = await client.perform(action)
        let status = await client.fetchStatus()?.status
        switch result {
        case .completed(let completion):
            return response(
                ok: true, command: command.name, resultCode: completionCode(completion),
                status: status, exitCode: 0, standardError: false
            )
        case .blocked(let blocker):
            return response(
                ok: false, command: command.name, resultCode: String(describing: blocker),
                status: status, exitCode: 77, standardError: true
            )
        }
    }

    private static func response(
        ok: Bool,
        command: String,
        resultCode: String,
        status: MacAccessXPCSafeStatus?,
        exitCode: Int32,
        standardError: Bool
    ) -> MacAccessCLIExecution {
        let value = MacAccessCLIResponse(
            ok: ok, command: command, resultCode: resultCode, status: status
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = (try? encoder.encode(value)) ?? Data()
        return MacAccessCLIExecution(
            exitCode: data.isEmpty ? 70 : exitCode,
            output: data + Data("\n".utf8),
            standardError: standardError || data.isEmpty
        )
    }

    private static func completionCode(_ completion: ConnectorCoreCompletion) -> String {
        switch completion {
        case .paired: "paired"
        case .unpaired: "unpaired"
        case .connected: "connected"
        case .disconnected: "disconnected"
        case .revoked: "revoked"
        case .localStop: "stopped"
        case .localPause: "paused"
        case .localResume: "resumed"
        case .localEmergencyStop: "emergency_stopped"
        case .accessModeSet(let mode): mode.rawValue
        }
    }
}
