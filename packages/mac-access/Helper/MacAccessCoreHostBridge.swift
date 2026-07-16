import ApplicationServices
import Foundation

enum MacAccessCoreHostError: String, Error, Sendable {
    case runtimeUnavailable = "runtime_unavailable"
    case protocolViolation = "protocol_violation"
    case frameTooLarge = "frame_too_large"
    case runnerExited = "runner_exited"
    case policyDenied = "policy_denied"
    case unsupportedPort = "unsupported_port"
}

protocol MacAccessCoreHostChannel: Sendable {
    func send(_ data: Data) async throws
    func receiveLine() async throws -> Data
    func terminate() async
}

private actor MacAccessCoreHostWriter {
    let handle: FileHandle
    init(handle: FileHandle) { self.handle = handle }
    func send(_ data: Data) throws { try handle.write(contentsOf: data) }
}

private final class MacAccessCoreHostReader: @unchecked Sendable {
    private let handle: FileHandle
    init(handle: FileHandle) { self.handle = handle }

    func receiveLine() async throws -> Data {
        try await Task.detached { [handle] in
            var data = Data()
            while data.count <= MacAccessStdioCoreHostTransport.maximumFrameBytes {
                guard let byte = try handle.read(upToCount: 1), !byte.isEmpty else {
                    throw MacAccessCoreHostError.runnerExited
                }
                if byte[0] == 0x0a { return data }
                data.append(byte)
            }
            throw MacAccessCoreHostError.frameTooLarge
        }.value
    }
}

private final class MacAccessProcessCoreHostChannel: MacAccessCoreHostChannel, @unchecked Sendable {
    private let process: Process
    private let writer: MacAccessCoreHostWriter
    private let reader: MacAccessCoreHostReader

    init(executable: URL, arguments: [String]) throws {
        let input = Pipe()
        let output = Pipe()
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.environment = [
            "HOME": FileManager.default.homeDirectoryForCurrentUser.path,
            "LANG": "C.UTF-8",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONNOUSERSITE": "1",
        ]
        try process.run()
        self.process = process
        writer = MacAccessCoreHostWriter(handle: input.fileHandleForWriting)
        reader = MacAccessCoreHostReader(handle: output.fileHandleForReading)
    }

    func send(_ data: Data) async throws { try await writer.send(data) }
    func receiveLine() async throws -> Data { try await reader.receiveLine() }
    func terminate() async { if process.isRunning { process.terminate() } }
}

actor MacAccessNativeClickPort {
    typealias Performer = @Sendable (_ x: Double, _ y: Double) async -> Bool

    private let performer: Performer
    private let isAccessibilityTrusted: @Sendable () -> Bool
    private var actions: [String: Task<[String: JSONValue], Never>] = [:]

    init(
        performer: @escaping Performer = MacAccessNativeClickPort.performSystemClick,
        isAccessibilityTrusted: @escaping @Sendable () -> Bool = AXIsProcessTrusted
    ) {
        self.performer = performer
        self.isAccessibilityTrusted = isAccessibilityTrusted
    }

    func validationError(for envelope: [String: JSONValue]) -> String? {
        guard let command = envelope["command"]?.object,
              command["capability"]?.string == "customer_mac.desktop_click",
              let request = command["request"]?.object,
              Set(request.keys) == Set(["x", "y"]),
              let x = request["x"]?.number, let y = request["y"]?.number,
              x.isFinite, y.isFinite, (0...1).contains(x), (0...1).contains(y)
        else { return "invalid_click_request" }
        return isAccessibilityTrusted() ? nil : "tcc_unavailable"
    }

    func begin(envelope: [String: JSONValue]) throws -> String {
        guard validationError(for: envelope) == nil,
              let request = envelope["command"]?.object?["request"]?.object,
              let x = request["x"]?.number, let y = request["y"]?.number
        else { throw MacAccessCoreHostError.policyDenied }
        let actionID = "action-\(UUID().uuidString.lowercased())"
        let performer = self.performer
        actions[actionID] = Task {
            guard !Task.isCancelled else { return ["outcome": .string("stopped")] }
            let succeeded = await performer(x, y)
            guard !Task.isCancelled else { return ["outcome": .string("stopped")] }
            return ["outcome": .string(succeeded ? "executed" : "failed")]
        }
        return actionID
    }

    func wait(actionID: String) async -> [String: JSONValue] {
        guard let task = actions[actionID] else {
            return ["outcome": .string("failed")]
        }
        let value = await task.value
        actions.removeValue(forKey: actionID)
        return value
    }

    func cancelAll() async {
        let tasks = Array(actions.values)
        for task in tasks { task.cancel() }
        for task in tasks { _ = await task.value }
        actions.removeAll()
    }

    private static func performSystemClick(x: Double, y: Double) async -> Bool {
        guard AXIsProcessTrusted(), let display = CGDisplayBounds(CGMainDisplayID()) as CGRect?,
              let source = CGEventSource(stateID: .hidSystemState)
        else { return false }
        let point = CGPoint(x: display.minX + display.width * x, y: display.minY + display.height * y)
        guard let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown,
                                 mouseCursorPosition: point, mouseButton: .left),
              let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp,
                               mouseCursorPosition: point, mouseButton: .left)
        else { return false }
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        return !Task.isCancelled
    }
}

actor MacAccessCoreHostPortDispatcher {
    private let custody: MacAccessPolicyCustody
    private let audit: MacAccessAuditCustody
    private let native: MacAccessNativeClickPort
    private let vault: any MacAccessCredentialVault
    private let now: @Sendable () -> Date
    private let verifier: MacAccessCommandVerifier?

    init(
        custody: MacAccessPolicyCustody,
        audit: MacAccessAuditCustody,
        native: MacAccessNativeClickPort,
        vault: any MacAccessCredentialVault,
        pinnedKeys: MacAccessPinnedKeys? = nil,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.custody = custody
        self.audit = audit
        self.native = native
        self.vault = vault
        verifier = pinnedKeys.map(MacAccessCommandVerifier.init(keys:))
        self.now = now
    }

    func handle(port: String, method: String, arguments: [String: JSONValue]) async throws -> JSONValue {
        switch (port, method) {
        case ("state", "load"):
            return .object(await custody.loadState())
        case ("state", "compare_and_swap"):
            guard let revision = arguments["expected_revision"]?.integer,
                  let state = arguments["state"]?.object
            else { throw MacAccessPolicyCustodyError.invalidRequest }
            return .boolean(try await custody.compareAndSwap(expectedRevision: revision, state: state))
        case ("state", "replace_corrupt"):
            guard let state = arguments["state"]?.object else {
                throw MacAccessPolicyCustodyError.invalidRequest
            }
            return .boolean(try await custody.replaceCorrupt(state: state))
        case ("pairing", "claim"):
            guard arguments["pairing_code"]?.string != nil,
                  arguments["local_installation_nonce"]?.string != nil,
                  let binding = try await vault.load()?.binding
            else { throw MacAccessCoreHostError.policyDenied }
            let data = try JSONEncoder().encode(binding)
            guard case .object(let encoded) = try JSONDecoder().decode(JSONValue.self, from: data) else {
                throw MacAccessCoreHostError.protocolViolation
            }
            return .object(["binding": .object(encoded), "confirmed": .boolean(true)])
        case ("identity", "runtime_is_current"):
            return .boolean(true)
        case ("credential", "erase_active"):
            try await vault.erase()
            return .null
        case ("queue", "clear"):
            return .null
        case ("transport", "connect"):
            guard let binding = arguments["binding"]?.object else {
                throw MacAccessPolicyCustodyError.invalidRequest
            }
            return .object(["state": .string("connected"), "binding": .object(binding)])
        case ("transport", "disconnect"), ("transport", "revoke"), ("transport", "block"):
            await native.cancelAll()
            try await custody.invalidateAuthorityAndPersist()
            return .null
        case ("clock", "validate_authority_window"):
            guard let envelope = arguments["envelope"]?.object else {
                throw MacAccessPolicyCustodyError.invalidRequest
            }
            return Self.validateWindow(envelope, now: now()).map(JSONValue.string) ?? .null
        case ("authority", "confirm_full_access"):
            guard let state = arguments["state"]?.object else {
                throw MacAccessPolicyCustodyError.invalidRequest
            }
            return .boolean(await custody.hasFullAccessConfirmation(state: state))
        case ("authority", "validate_action"):
            guard let envelope = arguments["envelope"]?.object else {
                throw MacAccessPolicyCustodyError.invalidRequest
            }
            return await native.validationError(for: envelope).map(JSONValue.string) ?? .null
        case ("authority", "approve_action"):
            guard let envelope = arguments["envelope"]?.object,
                  arguments["state"]?.object != nil
            else { throw MacAccessPolicyCustodyError.invalidRequest }
            let projection = await custody.projectStatus()
            guard !projection.paused, !projection.killSwitch,
                  envelope["policy_epoch"]?.integer == projection.policyEpoch
            else { return .string("approval_denied") }
            if projection.effectiveMode == "full_access" {
                try await custody.authorizeNative(envelope: envelope)
                return .null
            }
            let rejection = try await custody.awaitApproval(envelope: envelope)
            if rejection == nil { try await custody.authorizeNative(envelope: envelope) }
            return rejection.map(JSONValue.string) ?? .null
        case ("replay", "burn"):
            guard let envelope = arguments["envelope"]?.object else {
                throw MacAccessPolicyCustodyError.invalidRequest
            }
            return .boolean(try await custody.burnReplay(envelope: envelope))
        case ("replay", "invalidate_pending"):
            try await custody.invalidateAuthorityAndPersist()
            return .null
        case ("audit", "anchor_healthy"):
            return .boolean(await audit.anchorHealthy())
        case ("audit", "committed_cursor"):
            return await audit.committedCursor().map(JSONValue.object) ?? .null
        case ("audit", "command_decision"):
            guard let envelope = arguments["envelope"]?.object,
                  let allowed = arguments["allowed"]?.boolean,
                  let reason = arguments["reason_code"]?.string
            else { throw MacAccessPolicyCustodyError.invalidRequest }
            let detail = arguments["detail_code"]?.string
            let mode = await custody.projectStatus().effectiveMode
            return .object(try await audit.append(
                envelope: envelope, accessMode: mode, allowed: allowed,
                reasonCode: reason, detailCode: detail
            ))
        case ("audit", "command_result"):
            guard let envelope = arguments["envelope"]?.object,
                  let decision = arguments["decision"]?.object,
                  let outcome = arguments["outcome"]?.string,
                  let reason = arguments["reason_code"]?.string,
                  let detail = arguments["detail_code"]?.string
            else { throw MacAccessPolicyCustodyError.invalidRequest }
            let mode = await custody.projectStatus().effectiveMode
            return .object(try await audit.append(
                envelope: envelope, accessMode: mode, decision: decision, outcome: outcome,
                reasonCode: reason, detailCode: detail
            ))
        case ("audit", "summary"):
            let cursor = arguments["after_cursor"]?.object
            guard let limit = arguments["limit"]?.integer, (1...100).contains(limit) else {
                throw MacAccessPolicyCustodyError.invalidRequest
            }
            return .object(try await audit.summary(after: cursor, limit: Int(limit)))
        case ("native", "begin"):
            guard let envelope = arguments["envelope"]?.object else {
                throw MacAccessPolicyCustodyError.invalidRequest
            }
            guard await custody.consumeNativeAuthorization(envelope: envelope) else {
                throw MacAccessCoreHostError.policyDenied
            }
            if let verifier {
                let data = try JSONEncoder().encode(JSONValue.object(envelope))
                let command = try JSONDecoder().decode(MacAccessBrokerCommand.self, from: data)
                guard let binding = try await vault.load()?.binding else {
                    throw MacAccessCoreHostError.policyDenied
                }
                try verifier.verify(
                    command,
                    expectedBinding: binding,
                    expectedSessionID: command.sessionID,
                    expectedChannelGenerationID: command.channelGenerationID,
                    now: now()
                )
            }
            return .object(["action_id": .string(try await native.begin(envelope: envelope))])
        case ("native", "wait"):
            guard let actionID = arguments["action_id"]?.string else {
                throw MacAccessPolicyCustodyError.invalidRequest
            }
            return .object(await native.wait(actionID: actionID))
        case ("native", "cancel_all"):
            await native.cancelAll()
            return .null
        case ("status", "snapshot"):
            throw MacAccessCoreHostError.unsupportedPort
        default:
            throw MacAccessCoreHostError.unsupportedPort
        }
    }

    private static func validateWindow(_ envelope: [String: JSONValue], now: Date) -> String? {
        guard let issued = envelope["issued_at"]?.string.flatMap(Self.date),
              let expires = envelope["expires_at"]?.string.flatMap(Self.date),
              let binding = envelope["binding"]?.object,
              let grantExpires = binding["grant_expires_at"]?.string.flatMap(Self.date)
        else { return "expired_authority" }
        guard issued <= now, now < expires, expires < grantExpires,
              expires.timeIntervalSince(issued) <= 60
        else { return "expired_authority" }
        return nil
    }

    private static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

actor MacAccessStdioCoreHostTransport {
    static let maximumFrameBytes = 1_048_576
    static let schema = "evaos.mac_connector_core.stdio.v1"
    typealias Launcher = @Sendable () throws -> any MacAccessCoreHostChannel

    private let launcher: Launcher
    private let dispatcher: MacAccessCoreHostPortDispatcher
    private var channel: (any MacAccessCoreHostChannel)?
    private var readerTask: Task<Void, Never>?
    private var pending: [String: CheckedContinuation<[String: JSONValue], Error>] = [:]
    private var portTasks: [String: Task<Void, Never>] = [:]
    private var channelGeneration: UInt64 = 0

    init(launcher: @escaping Launcher, dispatcher: MacAccessCoreHostPortDispatcher) {
        self.launcher = launcher
        self.dispatcher = dispatcher
    }

    func request(_ request: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let requestID = request["request_id"]?.string,
              MacAccessWire.isIdentifier(requestID), pending[requestID] == nil
        else { throw MacAccessCoreHostError.protocolViolation }
        let channel = try ensureChannel()
        let frame = JSONValue.object([
            "schema_version": .string(Self.schema),
            "message_type": .string("host_request"),
            "request": .object(request),
        ])
        let data = try Self.line(frame)
        return try await withCheckedThrowingContinuation { continuation in
            pending[requestID] = continuation
            Task {
                do { try await channel.send(data) }
                catch { self.fail(requestID: requestID, error: error) }
            }
        }
    }

    func shutdown() async {
        channelGeneration &+= 1
        readerTask?.cancel()
        readerTask = nil
        for task in portTasks.values { task.cancel() }
        portTasks.removeAll()
        await channel?.terminate()
        channel = nil
        failAll(MacAccessCoreHostError.runnerExited)
    }

    private func ensureChannel() throws -> any MacAccessCoreHostChannel {
        if let channel { return channel }
        let opened = try launcher()
        channelGeneration &+= 1
        let generation = channelGeneration
        channel = opened
        readerTask = Task { [weak self] in await self?.readLoop(opened, generation: generation) }
        return opened
    }

    private func readLoop(_ channel: any MacAccessCoreHostChannel, generation: UInt64) async {
        do {
            while !Task.isCancelled {
                let data = try await channel.receiveLine()
                guard data.count <= Self.maximumFrameBytes else {
                    throw MacAccessCoreHostError.frameTooLarge
                }
                try await accept(data, channel: channel)
            }
        } catch {
            if generation == channelGeneration {
                self.channel = nil
                failAll(error)
            }
            await channel.terminate()
        }
    }

    private func accept(_ data: Data, channel: any MacAccessCoreHostChannel) async throws {
        guard case .object(let frame) = try JSONDecoder().decode(JSONValue.self, from: data),
              frame["schema_version"]?.string == Self.schema,
              let type = frame["message_type"]?.string
        else { throw MacAccessCoreHostError.protocolViolation }
        switch type {
        case "host_response":
            guard Set(frame.keys) == Set(["schema_version", "message_type", "response"]),
                  let response = frame["response"]?.object,
                  let requestID = response["request_id"]?.string,
                  let continuation = pending.removeValue(forKey: requestID)
            else { throw MacAccessCoreHostError.protocolViolation }
            continuation.resume(returning: response)
        case "port_call":
            guard Set(frame.keys) == Set(["schema_version", "message_type", "call_id", "port", "method", "arguments"]),
                  let callID = frame["call_id"]?.string,
                  let port = frame["port"]?.string, let method = frame["method"]?.string,
                  let arguments = frame["arguments"]?.object,
                  MacAccessWire.isIdentifier(callID), portTasks[callID] == nil
            else { throw MacAccessCoreHostError.protocolViolation }
            portTasks[callID] = Task { [weak self, generation = channelGeneration] in
                await self?.handlePortCall(
                    callID: callID, port: port, method: method,
                    arguments: arguments, channel: channel,
                    generation: generation
                )
            }
        case "protocol_error":
            throw MacAccessCoreHostError.protocolViolation
        default:
            throw MacAccessCoreHostError.protocolViolation
        }
    }

    private func handlePortCall(
        callID: String,
        port: String,
        method: String,
        arguments: [String: JSONValue],
        channel: any MacAccessCoreHostChannel,
        generation: UInt64
    ) async {
        defer { portTasks[callID] = nil }
        let result: JSONValue
        let errorCode: String?
        do {
            result = try await dispatcher.handle(port: port, method: method, arguments: arguments)
            errorCode = nil
        } catch let error as MacAccessCoreHostError {
            result = .null
            errorCode = error.rawValue
        } catch let error as MacAccessPolicyCustodyError {
            result = .null
            errorCode = error.rawValue
        } catch {
            result = .null
            errorCode = "port_unavailable"
        }
        let response = JSONValue.object([
            "schema_version": .string(Self.schema),
            "message_type": .string("port_result"),
            "call_id": .string(callID),
            "ok": .boolean(errorCode == nil),
            "result": result,
            "error": errorCode.map { .object(["code": .string($0)]) } ?? .null,
        ])
        do { try await channel.send(Self.line(response)) }
        catch {
            if generation == channelGeneration {
                self.channel = nil
                failAll(error)
            }
            await channel.terminate()
        }
    }

    private func fail(requestID: String, error: Error) {
        pending.removeValue(forKey: requestID)?.resume(throwing: error)
    }

    private func failAll(_ error: Error) {
        let continuations = pending.values
        pending.removeAll()
        for continuation in continuations { continuation.resume(throwing: error) }
    }

    private static func line(_ value: JSONValue) throws -> Data {
        var data = try JSONEncoder().encode(value)
        data.append(0x0a)
        guard data.count <= maximumFrameBytes else { throw MacAccessCoreHostError.frameTooLarge }
        return data
    }

    static func productionLauncher(
        hostSessionID: String,
        bundle: Bundle = .main
    ) -> Launcher {
        { [bundle, hostSessionID] in
            guard let resources = bundle.resourceURL else {
                throw MacAccessCoreHostError.runtimeUnavailable
            }
            let root = resources.appendingPathComponent("MacConnectorCore", isDirectory: true)
            let python = root.appendingPathComponent("runtime/bin/python3")
            let source = root.appendingPathComponent("python", isDirectory: true)
            guard FileManager.default.isExecutableFile(atPath: python.path),
                  FileManager.default.fileExists(atPath: source.path)
            else { throw MacAccessCoreHostError.runtimeUnavailable }
            return try MacAccessProcessCoreHostChannel(
                executable: python,
                arguments: productionArguments(
                    source: source, hostSessionID: hostSessionID,
                    runtimeInstanceID: "runtime-\(UUID().uuidString.lowercased())"
                )
            )
        }
    }

    static func productionArguments(
        source: URL,
        hostSessionID: String,
        runtimeInstanceID: String
    ) -> [String] {
        let bootstrap = "import sys;sys.path.insert(0,sys.argv[1]);from evaos_desktop_bridge.host.stdio_runner import main;raise SystemExit(main(sys.argv[2:]))"
        return [
            "-I", "-c", bootstrap, source.path,
            "--host-session-id", hostSessionID,
            "--runtime-instance-id", runtimeInstanceID,
        ]
    }
}

actor MacAccessCoreHostClient {
    private let transport: MacAccessStdioCoreHostTransport
    private let custody: MacAccessPolicyCustody
    private let hostSessionID: String
    private var sequence: Int64 = 0
    private var policyEpoch: Int64?
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(
        transport: MacAccessStdioCoreHostTransport,
        hostSessionID: String,
        custody: MacAccessPolicyCustody
    ) {
        self.transport = transport
        self.hostSessionID = hostSessionID
        self.custody = custody
        policyEpoch = nil
    }

    func perform(operation: String, extras: [String: JSONValue] = [:]) async throws -> [String: JSONValue] {
        await acquire()
        defer { release() }
        return try await perform(operation: operation, extras: extras, allowsRestartRetry: true)
    }

    private func perform(
        operation: String,
        extras: [String: JSONValue],
        allowsRestartRetry: Bool
    ) async throws -> [String: JSONValue] {
        sequence += 1
        let expectedEpoch: Int64
        if let policyEpoch { expectedEpoch = policyEpoch }
        else { expectedEpoch = await custody.projectStatus().policyEpoch }
        var request: [String: JSONValue] = [
            "schema_version": .string("evaos.mac_connector_core.host_request.v1"),
            "request_id": .string("request-\(UUID().uuidString.lowercased())"),
            "host_session_id": .string(hostSessionID),
            "sequence": .integer(sequence),
            "operation": .string(operation),
            "expected_policy_epoch": operation == "status" ? .null : .integer(expectedEpoch),
        ]
        request.merge(extras) { _, new in new }
        let response = try await transport.request(request)
        guard response["schema_version"]?.string == "evaos.mac_connector_core.host_response.v1",
              response["request_id"]?.string == request["request_id"]?.string,
              response["host_session_id"]?.string == hostSessionID,
              response["sequence"]?.integer == sequence,
              response["operation"]?.string == operation,
              let nextEpoch = response["policy_epoch"]?.integer
        else { throw MacAccessCoreHostError.protocolViolation }
        policyEpoch = nextEpoch
        guard response["ok"]?.boolean == true, let result = response["result"]?.object else {
            if allowsRestartRetry,
               response["error"]?.object?["code"]?.string == "runtime_restarted" {
                return try await perform(
                    operation: operation, extras: extras, allowsRestartRetry: false
                )
            }
            throw MacAccessCoreHostError.policyDenied
        }
        return result
    }

    private func acquire() async {
        if !busy {
            busy = true
            return
        }
        await withCheckedContinuation { waiters.append($0) }
    }

    private func release() {
        if waiters.isEmpty { busy = false }
        else { waiters.removeFirst().resume() }
    }
}

struct CoreHostBackedMacAccessExecutor: MacAccessCommandExecutor {
    let client: MacAccessCoreHostClient?

    func execute(command: MacAccessBrokerCommand) async -> MacAccessExecutionResult {
        guard let client else { return PolicyUnavailableMacAccessExecutor.result() }
        do {
            let encoded = try JSONEncoder().encode(command)
            guard case .object(let envelope) = try JSONDecoder().decode(JSONValue.self, from: encoded) else {
                throw MacAccessCoreHostError.protocolViolation
            }
            let result = try await client.perform(
                operation: "dispatch_action",
                extras: ["envelope": .object(envelope)]
            )
            guard result["kind"]?.string == "action" else {
                throw MacAccessCoreHostError.protocolViolation
            }
            let outcome: MacAccessReceiptOutcome
            switch result["outcome"]?.string {
            case "executed": outcome = .executed
            case "denied": outcome = .denied
            case "stopped": outcome = .cancelled
            default: outcome = .failed
            }
            guard let auditID = result["result_audit_id"]?.string
                ?? result["decision_audit_id"]?.string,
                MacAccessWire.isIdentifier(auditID)
            else { throw MacAccessCoreHostError.protocolViolation }
            return MacAccessExecutionResult(
                localAuditID: auditID,
                outcome: outcome,
                errorCode: outcome == .executed ? nil : "policy_denied"
            )
        } catch {
            return PolicyUnavailableMacAccessExecutor.result()
        }
    }
}
