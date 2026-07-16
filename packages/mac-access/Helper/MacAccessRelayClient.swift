import Foundation

protocol MacAccessRelaySocket: Sendable {
    func send(_ data: Data) async throws
    func receive() async throws -> Data
    func close() async
}

protocol MacAccessRelaySocketFactory: Sendable {
    func open(url: URL) async throws -> any MacAccessRelaySocket
}

actor URLSessionMacAccessRelaySocket: MacAccessRelaySocket {
    private let task: URLSessionWebSocketTask

    init(url: URL, session: URLSession = .shared) {
        task = session.webSocketTask(with: url)
        task.maximumMessageSize = MacAccessWire.maximumFrameBytes
        task.resume()
    }

    func send(_ data: Data) async throws {
        let text = try MacAccessWire.webSocketText(from: data)
        do {
            try await task.send(.string(text))
        } catch {
            throw MacAccessPublicError.relayUnavailable
        }
    }

    func receive() async throws -> Data {
        do {
            switch try await task.receive() {
            case .data(let data):
                guard data.count <= MacAccessWire.maximumFrameBytes else {
                    throw MacAccessPublicError.invalidWireMessage
                }
                return data
            case .string(let string):
                let data = Data(string.utf8)
                guard data.count <= MacAccessWire.maximumFrameBytes else {
                    throw MacAccessPublicError.invalidWireMessage
                }
                return data
            @unknown default:
                throw MacAccessPublicError.invalidWireMessage
            }
        } catch let error as MacAccessPublicError {
            throw error
        } catch {
            throw MacAccessPublicError.relayUnavailable
        }
    }

    func close() {
        task.cancel(with: .goingAway, reason: nil)
    }
}

struct URLSessionMacAccessRelaySocketFactory: MacAccessRelaySocketFactory {
    func open(url: URL) async throws -> any MacAccessRelaySocket {
        guard url.scheme == "wss", url.path == MacAccessWire.relayPath,
              url.query == nil, url.fragment == nil, url.host != nil
        else { throw MacAccessPublicError.relayUnavailable }
        return URLSessionMacAccessRelaySocket(url: url)
    }
}

struct MacAccessExecutionResult: Equatable, Sendable {
    let localAuditID: String
    let outcome: MacAccessReceiptOutcome
    let errorCode: String?

    init(localAuditID: String, outcome: MacAccessReceiptOutcome, errorCode: String? = nil) {
        self.localAuditID = localAuditID
        self.outcome = outcome
        self.errorCode = errorCode
    }
}

protocol MacAccessCommandExecutor: Sendable {
    func execute(command: MacAccessBrokerCommand) async -> MacAccessExecutionResult
}

enum MacAccessTransportSafetyEvent: Equatable, Sendable {
    case grantRevoked
    case grantExpired
    case channelClosed
}

protocol MacAccessTransportSafetySink: Sendable {
    func preemptTransportSafety(_ event: MacAccessTransportSafetyEvent) async throws
}

struct PolicyUnavailableMacAccessExecutor: MacAccessCommandExecutor {
    func execute(command _: MacAccessBrokerCommand) async -> MacAccessExecutionResult { Self.result() }

    static func result() -> MacAccessExecutionResult {
        MacAccessExecutionResult(
            localAuditID: "policy-unavailable-\(UUID().uuidString.lowercased())",
            outcome: .denied,
            errorCode: MacAccessPublicError.policyUnavailable.rawValue
        )
    }
}

enum MacAccessHelperPairingState: String, Equatable, Sendable {
    case unpaired, pairing, paired, revoked
}

enum MacAccessHelperTransportState: String, Equatable, Sendable {
    case disconnected, connecting, connected, blocked, stopped
}

struct MacAccessHelperSafeStatus: Equatable, Sendable {
    var pairing: MacAccessHelperPairingState
    var transport: MacAccessHelperTransportState
    var lastError: MacAccessPublicError?
    var lastAuditID: String?

    static let initial = MacAccessHelperSafeStatus(
        pairing: .unpaired,
        transport: .disconnected,
        lastError: nil,
        lastAuditID: nil
    )
}

actor MacAccessHelperRuntime {
    private struct Channel: Sendable {
        let generation: UInt64
        let socket: any MacAccessRelaySocket
        let binding: MacAccessSelectedBinding
        var ack: MacAccessRelayRegistrationAck?
    }

    private let vault: any MacAccessCredentialVault
    private let redeemer: any MacAccessPairingRedeemer
    private let socketFactory: any MacAccessRelaySocketFactory
    private let executor: any MacAccessCommandExecutor
    private let safetySink: (any MacAccessTransportSafetySink)?
    private let verifier: MacAccessCommandVerifier
    private let relayURL: URL
    private let now: @Sendable () -> Date
    private let sleepFor: @Sendable (TimeInterval) async throws -> Void

    private var channelGeneration: UInt64 = 0
    private var channel: Channel?
    private var credentialMutationInProgress = false
    private var channelTransitionInProgress = false
    private var pairingBeforeOperation: MacAccessHelperPairingState?
    private var revocationLatched = false
    private var safetyTransitionGeneration: UInt64?
    private var receiveLoopGeneration: UInt64?
    private var receivePumpTask: Task<Void, Never>?
    private var grantExpiryTask: Task<Void, Never>?
    private var inboundCommandFrames: [Data] = []
    private var inboundCommandWaiter: CheckedContinuation<Data, any Error>?
    private var replayWindow = MacAccessReplayWindow()
    private(set) var status: MacAccessHelperSafeStatus = .initial

    init(
        vault: any MacAccessCredentialVault,
        redeemer: any MacAccessPairingRedeemer,
        socketFactory: any MacAccessRelaySocketFactory,
        executor: any MacAccessCommandExecutor = PolicyUnavailableMacAccessExecutor(),
        safetySink: (any MacAccessTransportSafetySink)? = nil,
        pinnedKeys: MacAccessPinnedKeys,
        relayURL: URL,
        now: @escaping @Sendable () -> Date = Date.init,
        sleepFor: @escaping @Sendable (TimeInterval) async throws -> Void = { interval in
            let maximumInterval = TimeInterval(UInt64.max) / 1_000_000_000
            let nanoseconds = UInt64(min(max(0, interval), maximumInterval) * 1_000_000_000)
            try await Task.sleep(nanoseconds: nanoseconds)
        }
    ) {
        self.vault = vault
        self.redeemer = redeemer
        self.socketFactory = socketFactory
        self.executor = executor
        self.safetySink = safetySink
        verifier = MacAccessCommandVerifier(keys: pinnedKeys)
        self.relayURL = relayURL
        self.now = now
        self.sleepFor = sleepFor
    }

    @discardableResult
    func pair(code: String) async throws -> MacAccessHelperSafeStatus {
        guard status.pairing != .pairing, !credentialMutationInProgress,
              !channelTransitionInProgress, safetyTransitionGeneration == nil
        else {
            throw MacAccessPublicError.pairingRejected
        }
        let previousStatus = status
        let operationGeneration = channelGeneration
        var ownedCommitGeneration: UInt64?
        do {
            let normalizedCode = try MacAccessPairingCode.normalize(code)
            status.pairing = .pairing
            pairingBeforeOperation = previousStatus.pairing
            status.lastError = nil
            let identity = try await MacAccessInstallationIdentity.loadOrCreate(in: vault)
            let proof = try identity.proof(pairingCode: normalizedCode)
            let response = try await redeemer.redeem(
                MacAccessPairingRedemptionRequest(proof: proof),
                now: now()
            )
            guard response.selectedBinding.connectorInstallationID == identity.record.connectorInstallationID,
                  response.selectedBinding.connectorKeyID == identity.record.connectorKeyID
            else { throw MacAccessPublicError.wrongBinding }
            try requireCurrentGeneration(operationGeneration)
            let oldBinding = identity.record.binding
            credentialMutationInProgress = true
            let commitGeneration = await invalidateChannel()
            try requireCurrentGeneration(commitGeneration)
            ownedCommitGeneration = commitGeneration
            var record = identity.record
            record.binding = response.selectedBinding
            record.relayCredential = response.relayCredential
            record.relayCredentialExpiresAt = response.relayCredentialExpiresAt
            record.pairingAuditID = response.auditID
            try await vault.save(record)
            try requireCurrentGeneration(commitGeneration)
            if oldBinding != response.selectedBinding { replayWindow.reset() }
            revocationLatched = false
            credentialMutationInProgress = false
            pairingBeforeOperation = nil
            status = MacAccessHelperSafeStatus(
                pairing: .paired,
                transport: .disconnected,
                lastError: nil,
                lastAuditID: response.auditID
            )
            return status
        } catch let error as MacAccessPublicError {
            credentialMutationInProgress = false
            pairingBeforeOperation = nil
            if channelGeneration == (ownedCommitGeneration ?? operationGeneration) {
                status = previousStatus
                if ownedCommitGeneration != nil { status.transport = .disconnected }
                status.lastError = error
            }
            throw error
        } catch {
            credentialMutationInProgress = false
            pairingBeforeOperation = nil
            if channelGeneration == (ownedCommitGeneration ?? operationGeneration) {
                status = previousStatus
                if ownedCommitGeneration != nil { status.transport = .disconnected }
                status.lastError = .pairingRejected
            }
            throw MacAccessPublicError.pairingRejected
        }
    }

    @discardableResult
    func connect() async throws -> MacAccessHelperSafeStatus {
        guard !revocationLatched else { throw MacAccessPublicError.revoked }
        guard status.pairing != .pairing, !credentialMutationInProgress,
              !channelTransitionInProgress, safetyTransitionGeneration == nil
        else {
            throw MacAccessPublicError.credentialUnavailable
        }
        let generation = nextChannelGeneration()
        do {
            let previous = detachActiveChannel(failing: .stopped)
            if previous != nil {
                safetyTransitionGeneration = generation
                do {
                    try await safetySink?.preemptTransportSafety(.channelClosed)
                } catch {
                    // Native work was blocked before persistence was attempted.
                }
            }
            await previous?.close()
            if safetyTransitionGeneration == generation {
                safetyTransitionGeneration = nil
            }
            try requireCurrentGeneration(generation)
            guard let record = try await vault.load(), record.isPaired,
                  let binding = record.binding,
                  let credential = record.relayCredential,
                  let credentialExpiry = record.relayCredentialExpiresAt
            else { throw MacAccessPublicError.credentialUnavailable }
            let observedNow = now()
            if try MacAccessWire.parseInstant(
                binding.grantExpiresAt, allowingMilliseconds: true
            ) <= observedNow {
                try await latchGrantInvalidation(.grantExpired, transport: .stopped)
                throw MacAccessPublicError.revoked
            }
            guard try MacAccessWire.parseInstant(
                credentialExpiry, allowingMilliseconds: true
            ) > observedNow else { throw MacAccessPublicError.credentialUnavailable }
            try binding.validate(now: observedNow)
            status.transport = .connecting
            status.lastError = nil
            let opened = try await socketFactory.open(url: relayURL)
            guard generation == channelGeneration else {
                await opened.close()
                throw MacAccessPublicError.stopped
            }
            channel = Channel(generation: generation, socket: opened, binding: binding, ack: nil)
            let registration = MacAccessRelayRegistration(
                credential: credential,
                connectorInstallationID: record.connectorInstallationID,
                connectorKeyID: record.connectorKeyID,
                nonce: MacAccessWire.base64URL(try MacAccessWire.randomBytes(count: 24))
            )
            try await opened.send(MacAccessWire.canonicalData(registration))
            try requireOwnedChannel(generation)
            let ackData = try await opened.receive()
            try requireOwnedChannel(generation)
            let ackObject = try MacAccessWire.strictJSONObject(from: ackData)
            try MacAccessWire.requireExactKeys(
                ackObject,
                ["schema_version", "message_type", "session_id", "channel_generation_id"]
            )
            let ack = try MacAccessWire.decodeStrict(MacAccessRelayRegistrationAck.self, from: ackData)
            guard ack.schemaVersion == "evaos.mac_access.relay_registration_ack.v1",
                  ack.messageType == "registration_ack",
                  MacAccessWire.isIdentifier(ack.sessionID),
                  MacAccessWire.isIdentifier(ack.channelGenerationID)
            else { throw MacAccessPublicError.invalidWireMessage }
            channel?.ack = ack
            status.pairing = .paired
            status.transport = .connected
            startChannelTasks(
                generation: generation,
                socket: opened,
                binding: binding,
                ack: ack
            )
            return status
        } catch let error as MacAccessPublicError {
            if await closeChannel(ownedBy: generation) {
                status.transport = .blocked
                status.lastError = error
            }
            throw error
        } catch {
            if await closeChannel(ownedBy: generation) {
                status.transport = .blocked
                status.lastError = .relayUnavailable
            }
            throw MacAccessPublicError.relayUnavailable
        }
    }

    func processOneCommand() async throws -> MacAccessRelayReceipt {
        guard let owned = channel, let ack = owned.ack else {
            if revocationLatched { throw MacAccessPublicError.revoked }
            if status.transport == .disconnected || status.transport == .stopped {
                throw MacAccessPublicError.stopped
            }
            throw status.lastError ?? MacAccessPublicError.relayUnavailable
        }
        let generation = owned.generation
        do {
            if try MacAccessWire.parseInstant(
                owned.binding.grantExpiresAt, allowingMilliseconds: true
            ) <= now() {
                try await latchGrantInvalidation(.grantExpired, transport: .stopped)
                throw MacAccessPublicError.revoked
            }
            let frame = try await nextInboundCommandFrame(
                generation: generation,
                binding: owned.binding
            )
            try requireOwnedChannel(generation, binding: owned.binding)
            if try MacAccessWire.parseInstant(
                owned.binding.grantExpiresAt, allowingMilliseconds: true
            ) <= now() {
                try await latchGrantInvalidation(.grantExpired, transport: .stopped)
                throw MacAccessPublicError.revoked
            }
            let command = try verifier.decodeAndVerify(
                frame,
                expectedBinding: owned.binding,
                expectedSessionID: ack.sessionID,
                expectedChannelGenerationID: ack.channelGenerationID,
                now: now()
            )
            try requireOwnedChannel(generation, binding: owned.binding)
            try replayWindow.accept(command)
            let execution = await executor.execute(command: command)
            if revocationLatched { throw MacAccessPublicError.revoked }
            guard MacAccessWire.isIdentifier(execution.localAuditID),
                  execution.errorCode == nil || MacAccessWire.isIdentifier(execution.errorCode!)
            else { throw MacAccessPublicError.invalidWireMessage }
            try requireOwnedChannel(generation, binding: owned.binding)
            let receipt = MacAccessRelayReceipt(
                schemaVersion: "evaos.mac_access.relay_receipt.v1",
                messageType: "receipt",
                sessionID: command.sessionID,
                channelGenerationID: command.channelGenerationID,
                commandID: command.commandID,
                requestDigestSHA256: command.command.requestDigestSHA256,
                binding: command.binding,
                localAuditID: execution.localAuditID,
                outcome: execution.outcome,
                errorCode: execution.errorCode,
                sequence: command.sequence
            )
            try await owned.socket.send(MacAccessWire.canonicalData(receipt))
            try requireOwnedChannel(generation, binding: owned.binding)
            status.lastAuditID = execution.localAuditID
            status.lastError = execution.errorCode == MacAccessPublicError.policyUnavailable.rawValue
                ? .policyUnavailable : nil
            return receipt
        } catch let error as MacAccessPublicError {
            if error != .revoked, await closeChannel(ownedBy: generation) {
                status.transport = .blocked
                status.lastError = error
            }
            throw error
        } catch {
            if await closeChannel(ownedBy: generation) {
                status.transport = .blocked
                status.lastError = .relayUnavailable
            }
            throw MacAccessPublicError.relayUnavailable
        }
    }

    func processCommands() async {
        guard let generation = channel?.generation, channel?.ack != nil,
              receiveLoopGeneration != generation
        else { return }
        receiveLoopGeneration = generation
        defer {
            if receiveLoopGeneration == generation { receiveLoopGeneration = nil }
        }
        while channelGeneration == generation, channel?.generation == generation {
            do {
                _ = try await processOneCommand()
            } catch {
                return
            }
        }
    }

    @discardableResult
    func disconnect() async -> MacAccessHelperSafeStatus {
        channelTransitionInProgress = true
        if let pairingBeforeOperation { status.pairing = pairingBeforeOperation }
        status.transport = .disconnected
        status.lastError = nil
        _ = await invalidateChannel()
        channelTransitionInProgress = false
        return status
    }

    @discardableResult
    func stop() async throws -> MacAccessHelperSafeStatus {
        channelTransitionInProgress = true
        status = MacAccessHelperSafeStatus(
            pairing: pairingBeforeOperation ?? status.pairing,
            transport: .stopped,
            lastError: .stopped,
            lastAuditID: status.lastAuditID
        )
        _ = await invalidateChannel()
        channelTransitionInProgress = false
        return status
    }

    @discardableResult
    func revokeLocally() async throws -> MacAccessHelperSafeStatus {
        guard !credentialMutationInProgress, !channelTransitionInProgress else {
            throw MacAccessPublicError.credentialUnavailable
        }
        credentialMutationInProgress = true
        revocationLatched = true
        status.pairing = .revoked
        status.transport = .stopped
        status.lastError = .revoked
        _ = await invalidateChannel()
        do {
            try await vault.erase()
        } catch {
            credentialMutationInProgress = false
            throw error
        }
        replayWindow.reset()
        credentialMutationInProgress = false
        status = MacAccessHelperSafeStatus(
            pairing: .revoked,
            transport: .stopped,
            lastError: .revoked,
            lastAuditID: nil
        )
        return status
    }

    private func acceptRevoke(
        _ data: Data,
        expectedBinding: MacAccessSelectedBinding,
        ack: MacAccessRelayRegistrationAck,
        generation: UInt64
    ) async throws -> MacAccessPublicError {
        let root = try MacAccessWire.strictJSONObject(from: data)
        try MacAccessWire.requireExactKeys(root, [
            "schema_version", "message_type", "session_id", "channel_generation_id", "binding",
            "reason_code", "sequence",
        ])
        let binding = try MacAccessWire.requireObject(root["binding"])
        try MacAccessWire.requireExactKeys(
            binding, Set(MacAccessSelectedBinding.CodingKeys.allCases.map(\.stringValue))
        )
        let revoke = try MacAccessWire.decodeStrict(MacAccessRelayRevoke.self, from: data)
        guard revoke.schemaVersion == "evaos.mac_access.relay_revoke.v1",
              revoke.messageType == "revoke",
              revoke.sessionID == ack.sessionID,
              revoke.channelGenerationID == ack.channelGenerationID,
              revoke.binding == expectedBinding,
              ["grant_revoked", "local_stop", "reconnected", "relay_closed"].contains(revoke.reasonCode),
              (0...MacAccessWire.maximumSafeInteger).contains(revoke.sequence)
        else { throw MacAccessPublicError.wrongBinding }
        try requireOwnedChannel(generation, binding: expectedBinding)
        if revoke.reasonCode == "grant_revoked" {
            try await latchGrantInvalidation(.grantRevoked, transport: .stopped)
            return .revoked
        }

        let terminalError: MacAccessPublicError = revoke.reasonCode == "local_stop"
            ? .stopped : .relayUnavailable
        status.pairing = .paired
        status.transport = revoke.reasonCode == "local_stop" ? .disconnected : .blocked
        status.lastError = terminalError
        let transitionGeneration = nextChannelGeneration()
        safetyTransitionGeneration = transitionGeneration
        let activeSocket = detachActiveChannel(failing: terminalError)
        do {
            try await safetySink?.preemptTransportSafety(.channelClosed)
        } catch {
            // Local native work was already blocked before persistence was attempted.
        }
        await activeSocket?.close()
        if safetyTransitionGeneration == transitionGeneration {
            safetyTransitionGeneration = nil
        }
        return terminalError
    }

    private func acceptTerminalError(_ data: Data, generation: UInt64) async throws {
        let root = try MacAccessWire.strictJSONObject(from: data)
        try MacAccessWire.requireExactKeys(root, ["schema_version", "message_type", "code", "terminal"])
        let relayError = try MacAccessWire.decodeStrict(MacAccessRelayError.self, from: data)
        guard relayError.schemaVersion == "evaos.mac_access.relay_error.v1",
              relayError.messageType == "error", relayError.terminal
        else { throw MacAccessPublicError.invalidWireMessage }
        try requireOwnedChannel(generation)
        if relayError.code == "grant_revoked" {
            try await latchGrantInvalidation(.grantRevoked, transport: .blocked)
            return
        }
        status.transport = .blocked
        status.lastError = .relayUnavailable
        let transitionGeneration = nextChannelGeneration()
        safetyTransitionGeneration = transitionGeneration
        let activeSocket = detachActiveChannel(failing: .relayUnavailable)
        do {
            try await safetySink?.preemptTransportSafety(.channelClosed)
        } catch {
            // Keep transport closure authoritative when custody persistence fails.
        }
        await activeSocket?.close()
        if safetyTransitionGeneration == transitionGeneration {
            safetyTransitionGeneration = nil
        }
    }

    private func latchGrantInvalidation(
        _ event: MacAccessTransportSafetyEvent,
        transport: MacAccessHelperTransportState
    ) async throws {
        guard !revocationLatched else { throw MacAccessPublicError.revoked }
        credentialMutationInProgress = true
        revocationLatched = true
        status = MacAccessHelperSafeStatus(
            pairing: .revoked, transport: transport, lastError: .revoked, lastAuditID: nil
        )
        _ = nextChannelGeneration()
        let activeSocket = detachActiveChannel(failing: .revoked)
        do {
            try await safetySink?.preemptTransportSafety(event)
        } catch {
            // The policy sink blocks native work even when custody persistence fails.
            // Keep the transport latch authoritative and still erase relay credentials.
        }
        await activeSocket?.close()
        do {
            try await vault.erase()
        } catch {
            credentialMutationInProgress = false
            throw error
        }
        replayWindow.reset()
        credentialMutationInProgress = false
        status = MacAccessHelperSafeStatus(
            pairing: .revoked, transport: transport, lastError: .revoked, lastAuditID: nil
        )
    }

    private func startChannelTasks(
        generation: UInt64,
        socket: any MacAccessRelaySocket,
        binding: MacAccessSelectedBinding,
        ack: MacAccessRelayRegistrationAck
    ) {
        receivePumpTask?.cancel()
        grantExpiryTask?.cancel()
        failInboundCommands(.stopped)
        inboundCommandFrames.removeAll(keepingCapacity: true)
        receivePumpTask = Task {
            await self.runReceivePump(
                generation: generation,
                socket: socket,
                binding: binding,
                ack: ack
            )
        }
        grantExpiryTask = Task {
            await self.runGrantExpiryDeadline(generation: generation, binding: binding)
        }
    }

    private func runReceivePump(
        generation: UInt64,
        socket: any MacAccessRelaySocket,
        binding: MacAccessSelectedBinding,
        ack: MacAccessRelayRegistrationAck
    ) async {
        while !Task.isCancelled {
            do {
                let frame = try await socket.receive()
                try Task.checkCancellation()
                try requireOwnedChannel(generation, binding: binding)
                if try MacAccessWire.parseInstant(
                    binding.grantExpiresAt, allowingMilliseconds: true
                ) <= now() {
                    try await latchGrantInvalidation(.grantExpired, transport: .stopped)
                    return
                }
                let root = try MacAccessWire.strictJSONObject(from: frame)
                guard let messageType = root["message_type"] as? String else {
                    throw MacAccessPublicError.invalidWireMessage
                }
                switch messageType {
                case "command":
                    deliverInboundCommand(frame)
                case "revoke":
                    _ = try await acceptRevoke(
                        frame,
                        expectedBinding: binding,
                        ack: ack,
                        generation: generation
                    )
                    return
                case "error":
                    try await acceptTerminalError(frame, generation: generation)
                    return
                default:
                    throw MacAccessPublicError.invalidWireMessage
                }
            } catch is CancellationError {
                return
            } catch let error as MacAccessPublicError {
                if error != .revoked, error != .stopped {
                    await preemptChannelLoss(generation: generation, error: error)
                }
                return
            } catch {
                await preemptChannelLoss(generation: generation, error: .relayUnavailable)
                return
            }
        }
    }

    private func runGrantExpiryDeadline(
        generation: UInt64,
        binding: MacAccessSelectedBinding
    ) async {
        do {
            let deadline = try MacAccessWire.parseInstant(
                binding.grantExpiresAt, allowingMilliseconds: true
            )
            while !Task.isCancelled {
                let remaining = deadline.timeIntervalSince(now())
                if remaining <= 0 {
                    try requireOwnedChannel(generation, binding: binding)
                    try await latchGrantInvalidation(.grantExpired, transport: .stopped)
                    return
                }
                try await sleepFor(remaining)
            }
        } catch {
            return
        }
    }

    private func nextInboundCommandFrame(
        generation: UInt64,
        binding: MacAccessSelectedBinding
    ) async throws -> Data {
        try requireOwnedChannel(generation, binding: binding)
        if !inboundCommandFrames.isEmpty {
            return inboundCommandFrames.removeFirst()
        }
        guard inboundCommandWaiter == nil else {
            throw MacAccessPublicError.relayUnavailable
        }
        return try await withCheckedThrowingContinuation { continuation in
            inboundCommandWaiter = continuation
        }
    }

    private func deliverInboundCommand(_ frame: Data) {
        if let waiter = inboundCommandWaiter {
            inboundCommandWaiter = nil
            waiter.resume(returning: frame)
        } else {
            inboundCommandFrames.append(frame)
        }
    }

    private func failInboundCommands(_ error: MacAccessPublicError) {
        inboundCommandFrames.removeAll(keepingCapacity: true)
        if let waiter = inboundCommandWaiter {
            inboundCommandWaiter = nil
            waiter.resume(throwing: error)
        }
    }

    private func preemptChannelLoss(
        generation: UInt64,
        error: MacAccessPublicError
    ) async {
        guard generation == channelGeneration, channel?.generation == generation else { return }
        status.pairing = .paired
        status.transport = .blocked
        status.lastError = error
        let transitionGeneration = nextChannelGeneration()
        safetyTransitionGeneration = transitionGeneration
        let activeSocket = detachActiveChannel(failing: error)
        do {
            try await safetySink?.preemptTransportSafety(.channelClosed)
        } catch {
            // Closing the authenticated channel remains authoritative.
        }
        await activeSocket?.close()
        if safetyTransitionGeneration == transitionGeneration {
            safetyTransitionGeneration = nil
        }
    }

    private func nextChannelGeneration() -> UInt64 {
        channelGeneration &+= 1
        return channelGeneration
    }

    private func requireCurrentGeneration(_ generation: UInt64) throws {
        guard generation == channelGeneration else { throw MacAccessPublicError.stopped }
    }

    private func requireOwnedChannel(
        _ generation: UInt64,
        binding: MacAccessSelectedBinding? = nil
    ) throws {
        guard generation == channelGeneration, let channel, channel.generation == generation,
              binding == nil || channel.binding == binding
        else { throw MacAccessPublicError.stopped }
    }

    @discardableResult
    private func closeChannel(ownedBy generation: UInt64) async -> Bool {
        guard generation == channelGeneration, let active = channel,
              active.generation == generation
        else { return false }
        _ = detachActiveChannel(failing: revocationLatched ? .revoked : .stopped)
        await active.socket.close()
        return generation == channelGeneration
    }

    private func detachActiveChannel(
        failing error: MacAccessPublicError
    ) -> (any MacAccessRelaySocket)? {
        let active = channel
        receivePumpTask?.cancel()
        receivePumpTask = nil
        grantExpiryTask?.cancel()
        grantExpiryTask = nil
        failInboundCommands(error)
        channel = nil
        return active?.socket
    }

    @discardableResult
    private func invalidateChannel() async -> UInt64 {
        let generation = nextChannelGeneration()
        let activeSocket = detachActiveChannel(failing: revocationLatched ? .revoked : .stopped)
        await activeSocket?.close()
        return generation
    }
}
