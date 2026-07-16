import ApplicationServices
import Foundation

enum MacAccessCoreHostError: String, Error, Sendable {
    case runtimeUnavailable = "runtime_unavailable"
    case protocolViolation = "protocol_violation"
    case frameTooLarge = "frame_too_large"
    case runnerExited = "runner_exited"
    case policyDenied = "policy_denied"
    case unsupportedPort = "unsupported_port"
    case requestTimedOut = "request_timed_out"
}

struct MacAccessCoreHostResponseError: Error, Sendable {
    let code: String
    let auditID: String?
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
    private var blocked: Bool

    init(
        performer: @escaping Performer = MacAccessNativeClickPort.performSystemClick,
        isAccessibilityTrusted: @escaping @Sendable () -> Bool = AXIsProcessTrusted,
        initiallyBlocked: Bool = false
    ) {
        self.performer = performer
        self.isAccessibilityTrusted = isAccessibilityTrusted
        blocked = initiallyBlocked
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
        guard !blocked, validationError(for: envelope) == nil,
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

    func blockAndCancelAll() async {
        blocked = true
        await cancelAll()
    }

    func allowActions() {
        blocked = false
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
    private struct NativeActionBinding: Sendable {
        let envelope: [String: JSONValue]
        let envelopeDigestSHA256: String
    }

    private struct TerminalOutcomeBinding: Sendable {
        let envelope: [String: JSONValue]
        let outcome: String
        let reasonCode: String
        let detailCode: String
    }

    private let custody: MacAccessPolicyCustody
    private let audit: MacAccessAuditCustody
    private let native: MacAccessNativeClickPort
    private let vault: any MacAccessCredentialVault
    private let now: @Sendable () -> Date
    private let verifier: MacAccessCommandVerifier?
    private var committedAllowedDecisions: [String: [String: JSONValue]] = [:]
    private var allowedDecisionAuditsInFlight: Set<String> = []
    private var nativeActionBindings: [String: NativeActionBinding] = [:]
    private var unauditedTerminalOutcomes: [String: TerminalOutcomeBinding] = [:]
    private var resultAuditsInFlight: Set<String> = []

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
            await native.blockAndCancelAll()
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
            try await verifyEnvelope(envelope)
            let projection = await custody.projectStatus()
            guard !projection.paused, !projection.killSwitch,
                  envelope["policy_epoch"]?.integer == projection.policyEpoch
            else { return .string("approval_denied") }
            // Raw coordinate clicks remain locally confirmed in v0.1 even when the
            // broader mode is Full Access. A later target classifier may narrow this.
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
            guard unauditedTerminalOutcomes.isEmpty else { return .boolean(false) }
            return .boolean(await audit.anchorHealthy())
        case ("audit", "committed_cursor"):
            return await audit.committedCursor().map(JSONValue.object) ?? .null
        case ("audit", "command_decision"):
            guard let envelope = arguments["envelope"]?.object,
                  let allowed = arguments["allowed"]?.boolean,
                  let reason = arguments["reason_code"]?.string
            else { throw MacAccessPolicyCustodyError.invalidRequest }
            let detail = arguments["detail_code"]?.string
            let envelopeDigest = try Self.envelopeDigest(envelope)
            if allowed {
                guard reason == "approved_exact_scope", detail == nil,
                      committedAllowedDecisions[envelopeDigest] == nil,
                      !allowedDecisionAuditsInFlight.contains(envelopeDigest),
                      await custody.markAllowedDecisionCommitted(envelope: envelope)
                else { throw MacAccessPolicyCustodyError.invalidRequest }
                allowedDecisionAuditsInFlight.insert(envelopeDigest)
            }
            let mode = await custody.projectStatus().effectiveMode
            let event: [String: JSONValue]
            do {
                event = try await audit.append(
                    envelope: envelope, accessMode: mode, allowed: allowed,
                    reasonCode: reason, detailCode: detail
                )
            } catch {
                if allowed {
                    allowedDecisionAuditsInFlight.remove(envelopeDigest)
                    try? await custody.invalidateAuthorityAndPersist()
                }
                throw error
            }
            if allowed {
                allowedDecisionAuditsInFlight.remove(envelopeDigest)
                committedAllowedDecisions[envelopeDigest] = event
            }
            return .object(event)
        case ("audit", "command_result"):
            guard let envelope = arguments["envelope"]?.object,
                  let decision = arguments["decision"]?.object,
                  let outcome = arguments["outcome"]?.string,
                  let reason = arguments["reason_code"]?.string,
                  let detail = arguments["detail_code"]?.string
            else { throw MacAccessPolicyCustodyError.invalidRequest }
            let envelopeDigest = try Self.envelopeDigest(envelope)
            guard let terminal = unauditedTerminalOutcomes[envelopeDigest],
                  terminal.envelope == envelope,
                  terminal.outcome == outcome,
                  terminal.reasonCode == reason,
                  terminal.detailCode == detail,
                  let committedDecision = committedAllowedDecisions[envelopeDigest],
                  !resultAuditsInFlight.contains(envelopeDigest),
                  let decisionAuditID = decision["audit_id"]?.string,
                  MacAccessWire.isIdentifier(decisionAuditID),
                  committedDecision["audit_id"]?.string == decisionAuditID,
                  committedDecision == decision
            else { throw MacAccessPolicyCustodyError.invalidRequest }
            resultAuditsInFlight.insert(envelopeDigest)
            let event: [String: JSONValue]
            do {
                let mode = await custody.projectStatus().effectiveMode
                event = try await audit.append(
                    envelope: envelope, accessMode: mode, decision: decision, outcome: outcome,
                    reasonCode: reason, detailCode: detail
                )
            } catch {
                resultAuditsInFlight.remove(envelopeDigest)
                throw error
            }
            resultAuditsInFlight.remove(envelopeDigest)
            unauditedTerminalOutcomes.removeValue(forKey: envelopeDigest)
            committedAllowedDecisions.removeValue(forKey: envelopeDigest)
            return .object(event)
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
            try await verifyEnvelope(envelope)
            let envelopeDigest = try Self.envelopeDigest(envelope)
            guard committedAllowedDecisions[envelopeDigest] != nil,
                  unauditedTerminalOutcomes[envelopeDigest] == nil
            else { throw MacAccessCoreHostError.policyDenied }
            let actionID = try await native.begin(envelope: envelope)
            guard nativeActionBindings[actionID] == nil else {
                await native.blockAndCancelAll()
                throw MacAccessCoreHostError.protocolViolation
            }
            nativeActionBindings[actionID] = NativeActionBinding(
                envelope: envelope, envelopeDigestSHA256: envelopeDigest
            )
            return .object(["action_id": .string(actionID)])
        case ("native", "wait"):
            guard let actionID = arguments["action_id"]?.string,
                  let binding = nativeActionBindings.removeValue(forKey: actionID)
            else {
                throw MacAccessPolicyCustodyError.invalidRequest
            }
            let result = await native.wait(actionID: actionID)
            guard let outcome = result["outcome"]?.string,
                  let detail = Self.terminalDetail(for: outcome),
                  unauditedTerminalOutcomes[binding.envelopeDigestSHA256] == nil
            else {
                throw MacAccessCoreHostError.protocolViolation
            }
            unauditedTerminalOutcomes[binding.envelopeDigestSHA256] = TerminalOutcomeBinding(
                envelope: binding.envelope,
                outcome: outcome,
                reasonCode: "approved_exact_scope",
                detailCode: detail
            )
            return .object(result)
        case ("native", "cancel_all"):
            await native.blockAndCancelAll()
            return .null
        case ("status", "snapshot"):
            throw MacAccessCoreHostError.unsupportedPort
        default:
            throw MacAccessCoreHostError.unsupportedPort
        }
    }

    func failClosedOnChannelLoss() async {
        _ = try? await custody.activateEmergencyKill()
        await native.blockAndCancelAll()
    }

    private func verifyEnvelope(_ envelope: [String: JSONValue]) async throws {
        guard let verifier else { return }
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

    private static func envelopeDigest(_ envelope: [String: JSONValue]) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return MacAccessWire.sha256Hex(try encoder.encode(JSONValue.object(envelope)))
    }

    private static func terminalDetail(for outcome: String) -> String? {
        switch outcome {
        case "executed": "actuation_succeeded"
        case "failed": "actuation_failed"
        case "stopped": "actuation_cancelled"
        default: nil
        }
    }

    private static func validateWindow(_ envelope: [String: JSONValue], now: Date) -> String? {
        guard let issued = envelope["issued_at"]?.string.flatMap(Self.date),
              let expires = envelope["expires_at"]?.string.flatMap(Self.date),
              let binding = envelope["binding"]?.object,
              let grantExpires = binding["grant_expires_at"]?.string.flatMap(Self.date)
        else { return "expired_authority" }
        guard now < grantExpires else { return "grant_expired" }
        guard issued <= now.addingTimeInterval(5), now < expires, expires < grantExpires,
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
    private let requestTimeout: Duration
    private var channel: (any MacAccessCoreHostChannel)?
    private var readerTask: Task<Void, Never>?
    private var pending: [String: CheckedContinuation<[String: JSONValue], Error>] = [:]
    private var requestTimeouts: [String: Task<Void, Never>] = [:]
    private var portTasks: [String: Task<Void, Never>] = [:]
    private var channelGeneration: UInt64 = 0

    init(
        launcher: @escaping Launcher,
        dispatcher: MacAccessCoreHostPortDispatcher,
        requestTimeout: Duration = .seconds(75)
    ) {
        self.launcher = launcher
        self.dispatcher = dispatcher
        self.requestTimeout = requestTimeout
    }

    func request(_ request: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let requestID = request["request_id"]?.string,
              MacAccessWire.isIdentifier(requestID), pending[requestID] == nil
        else { throw MacAccessCoreHostError.protocolViolation }
        let channel = try ensureChannel()
        let generation = channelGeneration
        let frame = JSONValue.object([
            "schema_version": .string(Self.schema),
            "message_type": .string("host_request"),
            "request": .object(request),
        ])
        let data = try Self.line(frame)
        let timeout = requestTimeout
        return try await withCheckedThrowingContinuation { continuation in
            pending[requestID] = continuation
            requestTimeouts[requestID] = Task { [weak self] in
                try? await Task.sleep(for: timeout)
                guard !Task.isCancelled else { return }
                await self?.timeoutRequest(
                    requestID: requestID, channel: channel, generation: generation
                )
            }
            Task {
                do { try await channel.send(data) }
                catch {
                    await self.failChannel(
                        requestID: requestID, error: error,
                        channel: channel, generation: generation
                    )
                }
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
                try await accept(data, channel: channel, generation: generation)
            }
        } catch {
            if generation == channelGeneration {
                self.channel = nil
                failAll(error)
                await dispatcher.failClosedOnChannelLoss()
            }
            await channel.terminate()
        }
    }

    private func accept(
        _ data: Data, channel: any MacAccessCoreHostChannel, generation: UInt64
    ) async throws {
        guard generation == channelGeneration,
              case .object(let frame) = try JSONDecoder().decode(JSONValue.self, from: data),
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
            requestTimeouts.removeValue(forKey: requestID)?.cancel()
            continuation.resume(returning: response)
        case "port_call":
            guard Set(frame.keys) == Set(["schema_version", "message_type", "call_id", "port", "method", "arguments"]),
                  let callID = frame["call_id"]?.string,
                  let port = frame["port"]?.string, let method = frame["method"]?.string,
                  let arguments = frame["arguments"]?.object,
                  MacAccessWire.isIdentifier(callID), portTasks[callID] == nil
            else { throw MacAccessCoreHostError.protocolViolation }
            portTasks[callID] = Task { [weak self] in
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
        guard generation == channelGeneration else { return }
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
        guard generation == channelGeneration else { return }
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
                await dispatcher.failClosedOnChannelLoss()
            }
            await channel.terminate()
        }
    }

    private func fail(requestID: String, error: Error) {
        requestTimeouts.removeValue(forKey: requestID)?.cancel()
        pending.removeValue(forKey: requestID)?.resume(throwing: error)
    }

    private func timeoutRequest(
        requestID: String,
        channel timedOutChannel: any MacAccessCoreHostChannel,
        generation: UInt64
    ) async {
        guard pending[requestID] != nil, generation == channelGeneration else { return }
        channelGeneration &+= 1
        readerTask?.cancel()
        readerTask = nil
        channel = nil
        failAll(MacAccessCoreHostError.requestTimedOut)
        await dispatcher.failClosedOnChannelLoss()
        await timedOutChannel.terminate()
    }

    private func failChannel(
        requestID: String,
        error: Error,
        channel failedChannel: any MacAccessCoreHostChannel,
        generation: UInt64
    ) async {
        fail(requestID: requestID, error: error)
        guard generation == channelGeneration else { return }
        channel = nil
        failAll(error)
        await dispatcher.failClosedOnChannelLoss()
        await failedChannel.terminate()
    }

    private func failAll(_ error: Error) {
        for timeout in requestTimeouts.values { timeout.cancel() }
        requestTimeouts.removeAll()
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
            "-I", "-B", "-c", bootstrap, source.path,
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

    func resetPolicyEpoch() {
        policyEpoch = nil
    }

    func shutdown() async {
        policyEpoch = nil
        await transport.shutdown()
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
            guard let error = response["error"]?.object,
                  let code = error["code"]?.string,
                  MacAccessWire.isIdentifier(code),
                  error["audit_id"] == .null
                    || error["audit_id"]?.string.map(MacAccessWire.isIdentifier) == true
            else { throw MacAccessCoreHostError.protocolViolation }
            if allowsRestartRetry, code == "runtime_restarted" {
                return try await perform(
                    operation: operation, extras: extras, allowsRestartRetry: false
                )
            }
            throw MacAccessCoreHostResponseError(code: code, auditID: error["audit_id"]?.string)
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
    let audit: MacAccessAuditCustody?
    let custody: MacAccessPolicyCustody?

    init(
        client: MacAccessCoreHostClient?,
        audit: MacAccessAuditCustody? = nil,
        custody: MacAccessPolicyCustody? = nil
    ) {
        self.client = client
        self.audit = audit
        self.custody = custody
    }

    func execute(command: MacAccessBrokerCommand) async -> MacAccessExecutionResult {
        guard let client else { return await failClosedResult() }
        let envelope: [String: JSONValue]
        do {
            let encoded = try JSONEncoder().encode(command)
            guard case .object(let decoded) = try JSONDecoder().decode(JSONValue.self, from: encoded) else {
                throw MacAccessCoreHostError.protocolViolation
            }
            envelope = decoded
        } catch {
            return await failClosedResult()
        }
        do {
            if let custody { try await custody.authorizeRelayAdmission(envelope: envelope) }
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
            let decisionAuditID = result["decision_audit_id"]?.string
            let resultAuditID = result["result_audit_id"]?.string
            guard let decisionAuditID, MacAccessWire.isIdentifier(decisionAuditID)
            else { throw MacAccessCoreHostError.protocolViolation }
            let auditID: String
            if outcome == .denied {
                guard resultAuditID == nil else { throw MacAccessCoreHostError.protocolViolation }
                auditID = decisionAuditID
            } else {
                guard let resultAuditID, MacAccessWire.isIdentifier(resultAuditID)
                else { throw MacAccessCoreHostError.protocolViolation }
                auditID = resultAuditID
            }
            if let audit {
                guard await auditMatchesCommand(
                    audit: audit,
                    envelope: envelope,
                    decisionAuditID: decisionAuditID,
                    resultAuditID: resultAuditID,
                    outcome: outcome
                )
                else { throw MacAccessCoreHostError.protocolViolation }
            }
            return MacAccessExecutionResult(
                localAuditID: auditID,
                outcome: outcome,
                errorCode: outcome == .executed ? nil : "policy_denied"
            )
        } catch let error as MacAccessCoreHostResponseError
            where error.code == "stale_command_policy_epoch" && error.auditID == nil {
            guard let audit, let custody else { return await failClosedResult() }
            do {
                let projection = await custody.projectStatus()
                let decision = try await audit.append(
                    envelope: envelope,
                    accessMode: projection.effectiveMode,
                    allowed: false,
                    reasonCode: error.code,
                    detailCode: nil
                )
                guard let auditID = decision["audit_id"]?.string,
                      await auditMatchesCommand(
                          audit: audit,
                          envelope: envelope,
                          decisionAuditID: auditID,
                          resultAuditID: nil,
                          outcome: .denied
                      )
                else { throw MacAccessCoreHostError.protocolViolation }
                return MacAccessExecutionResult(
                    localAuditID: auditID,
                    outcome: .denied,
                    errorCode: "policy_denied"
                )
            } catch {
                return await failClosedResult()
            }
        } catch {
            return await failClosedResult()
        }
    }

    private func auditMatchesCommand(
        audit: MacAccessAuditCustody,
        envelope: [String: JSONValue],
        decisionAuditID: String,
        resultAuditID: String?,
        outcome: MacAccessReceiptOutcome
    ) async -> Bool {
        guard let command = envelope["command"]?.object,
              let binding = envelope["binding"]?.object,
              let decision = await audit.committedEvent(auditID: decisionAuditID),
              decision["event_type"]?.string == "command_decision",
              decision["command_id"] == envelope["command_id"],
              decision["request_digest_sha256"] == command["request_digest_sha256"],
              decision["binding_fingerprint_sha256"] == binding["binding_fingerprint_sha256"],
              decision["outcome"]?.string == (outcome == .denied ? "denied" : "allowed")
        else { return false }
        guard outcome != .denied else { return resultAuditID == nil }
        let expectedOutcome = switch outcome {
        case .executed: "executed"
        case .failed: "failed"
        case .cancelled: "stopped"
        case .denied: "denied"
        }
        guard let resultAuditID,
              let result = await audit.committedEvent(auditID: resultAuditID),
              result["event_type"]?.string == "command_result",
              result["command_id"] == envelope["command_id"],
              result["request_digest_sha256"] == command["request_digest_sha256"],
              result["binding_fingerprint_sha256"] == binding["binding_fingerprint_sha256"],
              result["causation_audit_id"]?.string == decisionAuditID,
              result["outcome"]?.string == expectedOutcome
        else { return false }
        return true
    }

    private func failClosedResult() async -> MacAccessExecutionResult {
        if let custody { _ = try? await custody.activateEmergencyKill() }
        return PolicyUnavailableMacAccessExecutor.result()
    }

}
