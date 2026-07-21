import Darwin
import Foundation
import MacAccessShared

protocol MacAccessCLIClient: MacAccessPermissionControllingClient {}

extension MacAccessXPCConnectorCoreClient: MacAccessCLIClient {}

final class MacAccessControllerCLIClient: MacAccessCLIClient, @unchecked Sendable {
    private let controller: MacAccessController
    private let statusClient: any MacAccessPermissionControllingClient

    init(
        controller: MacAccessController,
        statusClient: any MacAccessPermissionControllingClient
    ) {
        self.controller = controller
        self.statusClient = statusClient
    }

    func perform(_ action: ConnectorCoreAction) async -> ConnectorCoreResult {
        if action == .stop {
            await controller.emergencyStop()
            for _ in 0..<50 {
                if let reply = await statusClient.fetchStatus(),
                   reply.status.transport == "stopped",
                   reply.status.accessMode == .off
                {
                    return .completed(.localEmergencyStop)
                }
                try? await Task.sleep(for: .milliseconds(50))
            }
            return .blocked(.relayUnavailable)
        }

        await controller.refreshFromHelper()
        switch await controller.perform(action) {
        case .completed(let completion):
            return .completed(completion)
        case .blocked(let blocker):
            return .blocked(blocker)
        case .invalidated(.localPrecondition(let blocker)):
            return .blocked(blocker)
        case .invalidated(.quitCleanup):
            return .blocked(.connectorCoreUnavailable)
        }
    }

    func fetchStatus() async -> MacAccessXPCReply? {
        await controller.refreshFromHelper()
        guard let reply = await statusClient.fetchStatus() else { return nil }
        let state = await controller.state
        guard state.blocker == .emergencyStopActive else { return reply }
        return MacAccessXPCReply(
            code: reply.code,
            status: MacAccessXPCSafeStatus(
                pairing: reply.status.pairing,
                transport: "stopped",
                lastErrorCode: "stopped",
                lastAuditID: reply.status.lastAuditID,
                permissions: reply.status.permissions,
                accessMode: .off
            )
        )
    }

    func requestPermission(_ kind: MacAccessPermissionKind) async -> MacAccessXPCReply? {
        await controller.requestPermission(kind)
        return await fetchStatus()
    }
}

enum MacAccessCLICommand: Equatable {
    case status, permissionStatus, requestAccessibility, requestScreenRecording
    case setup, pair, connect, disconnect, stop, unpair, revoke, modeOff, modeFull, help

    var name: String {
        switch self {
        case .status: "status"
        case .permissionStatus: "permissions_status"
        case .requestAccessibility: "permissions_request_accessibility"
        case .requestScreenRecording: "permissions_request_screen_recording"
        case .setup: "setup"
        case .pair: "pair"
        case .connect: "connect"
        case .disconnect: "disconnect"
        case .stop: "stop"
        case .revoke: "revoke"
        case .unpair: "unpair"
        case .modeOff: "mode_off"
        case .modeFull: "mode_full_access"
        case .help: "help"
        }
    }
}

struct MacAccessCLIResponse: Codable {
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
      setup
      permissions status
      permissions request accessibility
      permissions request screen-recording
      pair --code-stdin
      connect
      disconnect
      mode off
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
        case ["setup"]: return .setup
        case ["permissions", "status"]: return .permissionStatus
        case ["permissions", "request", "accessibility"]: return .requestAccessibility
        case ["permissions", "request", "screen-recording"]: return .requestScreenRecording
        case ["pair", "--code-stdin"]: return .pair
        case ["connect"]: return .connect
        case ["disconnect"]: return .disconnect
        case ["mode", "off"]: return .modeOff
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
        if command == .setup {
            return response(
                ok: false, command: command.name, resultCode: "app_unavailable",
                status: nil, exitCode: 69, standardError: true
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
        case .modeFull: action = .setAccessMode(.fullAccess)
        case .setup, .status, .permissionStatus, .requestAccessibility,
             .requestScreenRecording, .help:
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

    static func setupCompleted() -> MacAccessCLIExecution {
        response(
            ok: true, command: MacAccessCLICommand.setup.name, resultCode: "shown",
            status: nil, exitCode: 0, standardError: false
        )
    }

    static func appUnavailable(arguments: [String]) -> MacAccessCLIExecution {
        response(
            ok: false,
            command: parse(arguments: arguments)?.name ?? "unknown",
            resultCode: "app_unavailable",
            status: nil,
            exitCode: 69,
            standardError: true
        )
    }
}

private struct MacAccessLocalControlRequest: Codable {
    let schemaVersion = "evaos.mac_access.local_control_request.v1"
    let arguments: [String]
    let stdin: Data

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case arguments, stdin
    }
}

private struct MacAccessLocalControlResponse: Codable {
    let schemaVersion = "evaos.mac_access.local_control_response.v1"
    let exitCode: Int32
    let output: Data
    let standardError: Bool

    init(_ execution: MacAccessCLIExecution) {
        exitCode = execution.exitCode
        output = execution.output
        standardError = execution.standardError
    }

    var execution: MacAccessCLIExecution {
        MacAccessCLIExecution(
            exitCode: exitCode,
            output: output,
            standardError: standardError
        )
    }

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case exitCode = "exit_code"
        case output
        case standardError = "standard_error"
    }
}

enum MacAccessLocalControl {
    static let maximumFrameBytes = 64 << 10
    static let defaultSocketPath = "/tmp/evaos-mac-access-\(getuid()).sock"

    static func request(
        arguments: [String],
        stdin: Data,
        socketPath: String = defaultSocketPath
    ) -> MacAccessCLIExecution? {
        guard let body = try? JSONEncoder().encode(
            MacAccessLocalControlRequest(arguments: arguments, stdin: stdin)
        ), body.count <= maximumFrameBytes
        else { return nil }

        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return nil }
        defer { close(descriptor) }
        setTimeout(on: descriptor, seconds: 35)

        guard withUnixAddress(path: socketPath, operation: { address, length in
            Darwin.connect(descriptor, address, length)
        }) == 0,
              writeFrame(body, to: descriptor),
              let reply = readFrame(from: descriptor),
              let response = try? JSONDecoder().decode(
                  MacAccessLocalControlResponse.self, from: reply
              ),
              response.schemaVersion == "evaos.mac_access.local_control_response.v1"
        else { return nil }
        return response.execution
    }

    fileprivate static func withUnixAddress<Result>(
        path: String,
        operation: (UnsafePointer<sockaddr>, socklen_t) -> Result
    ) -> Result? {
        let bytes = Array(path.utf8CString)
        guard bytes.count <= MemoryLayout.size(ofValue: sockaddr_un().sun_path) else {
            return nil
        }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let length = socklen_t(MemoryLayout<sa_family_t>.size + bytes.count)
        address.sun_len = UInt8(length)
        withUnsafeMutableBytes(of: &address.sun_path) { destination in
            bytes.withUnsafeBytes { source in
                destination.copyBytes(from: source)
            }
        }
        return withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                operation($0, length)
            }
        }
    }

    fileprivate static func readFrame(from descriptor: Int32) -> Data? {
        guard let prefix = readExactly(4, from: descriptor) else { return nil }
        let length = prefix.reduce(0) { ($0 << 8) | Int($1) }
        guard length > 0, length <= maximumFrameBytes else { return nil }
        return readExactly(length, from: descriptor)
    }

    fileprivate static func writeFrame(_ body: Data, to descriptor: Int32) -> Bool {
        guard body.count > 0, body.count <= maximumFrameBytes else { return false }
        let length = UInt32(body.count).bigEndian
        let prefix = withUnsafeBytes(of: length) { Data($0) }
        return writeAll(prefix, to: descriptor) && writeAll(body, to: descriptor)
    }

    private static func readExactly(_ count: Int, from descriptor: Int32) -> Data? {
        var result = Data()
        result.reserveCapacity(count)
        var buffer = [UInt8](repeating: 0, count: min(count, 4096))
        while result.count < count {
            let wanted = min(buffer.count, count - result.count)
            let received = recv(descriptor, &buffer, wanted, 0)
            guard received > 0 else { return nil }
            result.append(buffer, count: received)
        }
        return result
    }

    private static func writeAll(_ data: Data, to descriptor: Int32) -> Bool {
        data.withUnsafeBytes { bytes in
            guard let base = bytes.baseAddress else { return false }
            var sent = 0
            while sent < data.count {
                let result = send(
                    descriptor,
                    base.advanced(by: sent),
                    data.count - sent,
                    MSG_NOSIGNAL
                )
                guard result > 0 else { return false }
                sent += result
            }
            return true
        }
    }

    private static func setTimeout(on descriptor: Int32, seconds: Int) {
        var timeout = timeval(tv_sec: seconds, tv_usec: 0)
        withUnsafePointer(to: &timeout) {
            _ = setsockopt(
                descriptor, SOL_SOCKET, SO_RCVTIMEO, $0,
                socklen_t(MemoryLayout<timeval>.size)
            )
            _ = setsockopt(
                descriptor, SOL_SOCKET, SO_SNDTIMEO, $0,
                socklen_t(MemoryLayout<timeval>.size)
            )
        }
    }
}

private final class MacAccessLocalControlReplyBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: MacAccessCLIExecution?

    func store(_ value: MacAccessCLIExecution) {
        lock.withLock {
            self.value = value
        }
    }

    func take() -> MacAccessCLIExecution? {
        lock.withLock {
            defer { value = nil }
            return value
        }
    }
}

final class MacAccessLocalControlServer: @unchecked Sendable {
    private let client: any MacAccessCLIClient
    private let showSetup: @MainActor @Sendable () -> Void
    private let socketPath: String
    private let queue = DispatchQueue(label: "com.evaos.mac-access.local-control")
    private var listener: Int32 = -1
    private var source: DispatchSourceRead?

    init(
        client: any MacAccessCLIClient,
        socketPath: String = MacAccessLocalControl.defaultSocketPath,
        showSetup: @escaping @MainActor @Sendable () -> Void
    ) {
        self.client = client
        self.socketPath = socketPath
        self.showSetup = showSetup
    }

    @discardableResult
    func start() -> Bool {
        queue.sync {
            guard listener < 0 else { return true }
            var existing = stat()
            if lstat(socketPath, &existing) == 0 {
                guard existing.st_mode & S_IFMT == S_IFSOCK else { return false }
                guard unlink(socketPath) == 0 else { return false }
            }

            let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
            guard descriptor >= 0 else { return false }
            guard MacAccessLocalControl.withUnixAddress(path: socketPath, operation: {
                Darwin.bind(descriptor, $0, $1)
            }) == 0,
                  chmod(socketPath, S_IRUSR | S_IWUSR) == 0,
                  Darwin.listen(descriptor, 8) == 0
            else {
                close(descriptor)
                _ = unlink(socketPath)
                return false
            }

            listener = descriptor
            let source = DispatchSource.makeReadSource(
                fileDescriptor: descriptor, queue: queue
            )
            source.setEventHandler { [weak self] in self?.acceptOne() }
            source.resume()
            self.source = source
            return true
        }
    }

    func stop() {
        queue.sync {
            source?.cancel()
            source = nil
            if listener >= 0 {
                close(listener)
                listener = -1
            }
            _ = unlink(socketPath)
        }
    }

    deinit {
        stop()
    }

    private func acceptOne() {
        var peerAddress = sockaddr()
        var peerLength = socklen_t(MemoryLayout<sockaddr>.size)
        let descriptor = withUnsafeMutablePointer(to: &peerAddress) {
            Darwin.accept(listener, $0, &peerLength)
        }
        guard descriptor >= 0 else { return }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.serve(descriptor)
        }
    }

    private func serve(_ descriptor: Int32) {
        defer { close(descriptor) }
        var peerUID: uid_t = 0
        var peerGID: gid_t = 0
        guard getpeereid(descriptor, &peerUID, &peerGID) == 0,
              peerUID == getuid(),
              let body = MacAccessLocalControl.readFrame(from: descriptor),
              let request = try? JSONDecoder().decode(
                  MacAccessLocalControlRequest.self, from: body
              ),
              request.schemaVersion == "evaos.mac_access.local_control_request.v1",
              request.stdin.count <= 64
        else { return }

        let semaphore = DispatchSemaphore(value: 0)
        let replyBox = MacAccessLocalControlReplyBox()
        Task {
            if MacAccessCLI.parse(arguments: request.arguments) == .setup {
                await showSetup()
                replyBox.store(MacAccessCLI.setupCompleted())
            } else {
                replyBox.store(await MacAccessCLI.execute(
                    arguments: request.arguments,
                    client: client,
                    readStdin: { request.stdin }
                ))
            }
            semaphore.signal()
        }
        guard semaphore.wait(timeout: .now() + 35) == .success,
              let response = replyBox.take(),
              let encoded = try? JSONEncoder().encode(
                  MacAccessLocalControlResponse(response)
              )
        else { return }
        _ = MacAccessLocalControl.writeFrame(encoded, to: descriptor)
    }
}
