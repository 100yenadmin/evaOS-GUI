import CryptoKit
import Foundation
import MacAccessShared
import Security

enum MacAccessPolicyCustodyError: String, Error, Sendable {
    case invalidRequest = "invalid_request"
    case persistenceUnavailable = "persistence_unavailable"
    case auditCorrupt = "audit_corrupt"
}

struct MacAccessPolicyPaths: Sendable {
    let directory: URL

    var custody: URL { directory.appendingPathComponent("policy-custody.json") }
    var audit: URL { directory.appendingPathComponent("audit.ndjson") }

    static func production(fileManager: FileManager = .default) throws -> Self {
        let root = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return Self(directory: root.appendingPathComponent("evaOS/MacAccess", isDirectory: true))
    }
}

private struct MacAccessStoredApproval: Codable, Equatable, Sendable {
    let commandID: String
    let capability: String
    let requestDigestSHA256: String
    let bindingFingerprintSHA256: String
    let policyEpoch: Int64
    let envelopeDigestSHA256: String
    let expiresAt: Date
}

private struct MacAccessCustodyDocument: Codable, Sendable {
    var state: [String: JSONValue]
    var approvals: [MacAccessStoredApproval]
    var replayTombstones: [String]
    var fullAccessConfirmationEpoch: Int64?
}

actor MacAccessPolicyCustody {
    private static let maximumApprovals = 32
    private static let maximumReplayTombstones = 4_096

    private let paths: MacAccessPolicyPaths
    private let fileManager: FileManager
    private let now: @Sendable () -> Date
    private var document: MacAccessCustodyDocument
    private var pendingApproval: MacAccessXPCPendingApproval?
    private var pendingContinuation: CheckedContinuation<Bool, Never>?
    private var nativeAuthorizationDigestSHA256: String?
    private var nativeDecisionAuditDigestSHA256: String?
    private var nativeBarrierOpen = false
    private var locallyAuthorizedMode: String?

    init(
        paths: MacAccessPolicyPaths,
        hostSessionID: String,
        fileManager: FileManager = .default,
        now: @escaping @Sendable () -> Date = Date.init
    ) throws {
        self.paths = paths
        self.fileManager = fileManager
        self.now = now
        try Self.prepareDirectory(paths.directory, fileManager: fileManager)
        if fileManager.fileExists(atPath: paths.custody.path) {
            do {
                let data = try Data(contentsOf: paths.custody)
                document = try JSONDecoder().decode(MacAccessCustodyDocument.self, from: data)
            } catch {
                document = Self.failClosedDocument(hostSessionID: hostSessionID)
                try Self.persist(document, to: paths.custody, fileManager: fileManager)
            }
        } else {
            document = Self.pristineDocument(hostSessionID: hostSessionID)
            try Self.persist(document, to: paths.custody, fileManager: fileManager)
        }
        let instant = now()
        document.approvals.removeAll { $0.expiresAt <= instant }
    }

    func loadState() -> [String: JSONValue] { document.state }

    func compareAndSwap(expectedRevision: Int64, state: [String: JSONValue]) throws -> Bool {
        guard document.state["revision"]?.integer == expectedRevision else { return false }
        if document.state["kill_switch"]?.boolean == true,
           state["kill_switch"]?.boolean != true {
            return false
        }
        let previous = document
        var replacement = state
        replacement["revision"] = .integer(expectedRevision + 1)
        document.state = replacement
        do { try persist() }
        catch { document = previous; throw error }
        return true
    }

    func replaceCorrupt(state: [String: JSONValue]) throws -> Bool {
        var replacement = state
        let next = max(0, (document.state["revision"]?.integer ?? -1) + 1)
        replacement["revision"] = .integer(next)
        replacement["configured_mode"] = .string("off")
        replacement["effective_mode"] = .string("off")
        replacement["paused"] = .boolean(true)
        replacement["kill_switch"] = .boolean(true)
        replacement["transport_state"] = .string("blocked")
        document.state = replacement
        invalidateAuthority()
        locallyAuthorizedMode = nil
        try persist()
        return true
    }

    func projectStatus() -> MacAccessPolicyProjection {
        MacAccessPolicyProjection(
            pairing: document.state["pairing_state"]?.string ?? "revoked",
            configuredMode: document.state["configured_mode"]?.string ?? "off",
            effectiveMode: document.state["effective_mode"]?.string ?? "off",
            paused: document.state["paused"]?.boolean ?? true,
            killSwitch: document.state["kill_switch"]?.boolean ?? true,
            policyEpoch: document.state["policy_epoch"]?.integer ?? 0,
            transport: document.state["transport_state"]?.string ?? "blocked"
        )
    }

    func activateEmergencyKill() throws -> MacAccessPolicyProjection {
        let nextEpoch = min(9_007_199_254_740_991, (document.state["policy_epoch"]?.integer ?? 0) + 1)
        document.state["policy_epoch"] = .integer(nextEpoch)
        document.state["configured_mode"] = .string("off")
        document.state["effective_mode"] = .string("off")
        document.state["requested_target_mode"] = .null
        document.state["paused"] = .boolean(true)
        document.state["kill_switch"] = .boolean(true)
        document.state["transport_state"] = .string("blocked")
        document.state["local_confirmation_required"] = .boolean(false)
        document.state["confirmed_runtime_instance_id"] = .null
        document.state["confirmed_policy_epoch"] = .null
        document.state["confirmed_binding_fingerprint_sha256"] = .null
        invalidateAuthority()
        locallyAuthorizedMode = nil
        advanceRevision()
        try persist()
        return projectStatus()
    }

    func clearEmergencyKill(expectedPolicyEpoch: Int64) throws -> MacAccessPolicyProjection {
        guard document.state["kill_switch"]?.boolean == true,
              document.state["policy_epoch"]?.integer == expectedPolicyEpoch
        else {
            throw MacAccessPolicyCustodyError.invalidRequest
        }
        let nextEpoch = min(9_007_199_254_740_991, (document.state["policy_epoch"]?.integer ?? 0) + 1)
        document.state["policy_epoch"] = .integer(nextEpoch)
        document.state["pairing_state"] = .string("unpaired")
        document.state["selected_binding"] = .null
        document.state["configured_mode"] = .string("off")
        document.state["effective_mode"] = .string("off")
        document.state["requested_target_mode"] = .null
        document.state["paused"] = .boolean(false)
        document.state["kill_switch"] = .boolean(false)
        document.state["transport_state"] = .string("disconnected")
        document.state["local_confirmation_required"] = .boolean(false)
        invalidateAuthority()
        locallyAuthorizedMode = nil
        advanceRevision()
        try persist()
        return projectStatus()
    }

    func forceLocalSafety(_ operation: String) throws -> MacAccessPolicyProjection {
        guard ["off", "pause", "disconnect", "stop", "revoke"].contains(operation) else {
            throw MacAccessPolicyCustodyError.invalidRequest
        }
        let nextEpoch = min(9_007_199_254_740_991, (document.state["policy_epoch"]?.integer ?? 0) + 1)
        document.state["policy_epoch"] = .integer(nextEpoch)
        document.state["effective_mode"] = .string("off")
        document.state["requested_target_mode"] = .null
        if operation == "off" || operation == "stop" || operation == "revoke" {
            document.state["configured_mode"] = .string("off")
        }
        if operation == "pause" || operation == "stop" || operation == "revoke" {
            document.state["paused"] = .boolean(true)
        }
        if operation == "disconnect" { document.state["transport_state"] = .string("disconnected") }
        if operation == "stop" || operation == "revoke" {
            document.state["transport_state"] = .string("stopped")
        }
        if operation == "revoke" {
            document.state["pairing_state"] = .string("revoked")
            document.state["selected_binding"] = .null
        }
        invalidateAuthority()
        if operation == "off" || operation == "stop" || operation == "revoke" {
            locallyAuthorizedMode = nil
        }
        advanceRevision()
        try persist()
        return projectStatus()
    }

    func prepareRevokedStateForFreshPairing() throws -> MacAccessPolicyProjection {
        guard document.state["pairing_state"]?.string == "revoked",
              document.state["kill_switch"]?.boolean == false
        else { throw MacAccessPolicyCustodyError.invalidRequest }
        let nextEpoch = min(9_007_199_254_740_991, (document.state["policy_epoch"]?.integer ?? 0) + 1)
        document.state["policy_epoch"] = .integer(nextEpoch)
        document.state["pairing_state"] = .string("unpaired")
        document.state["selected_binding"] = .null
        document.state["configured_mode"] = .string("off")
        document.state["effective_mode"] = .string("off")
        document.state["requested_target_mode"] = .null
        document.state["paused"] = .boolean(false)
        document.state["transport_state"] = .string("disconnected")
        document.state["local_confirmation_required"] = .boolean(false)
        invalidateAuthority()
        locallyAuthorizedMode = nil
        advanceRevision()
        try persist()
        return projectStatus()
    }

    func recordApproval(
        commandID: String,
        capability: String,
        requestDigestSHA256: String,
        bindingFingerprintSHA256: String,
        policyEpoch: Int64,
        envelopeDigestSHA256: String,
        ttl: TimeInterval
    ) throws {
        guard MacAccessWire.isIdentifier(commandID),
              capability == "customer_mac.desktop_click",
              MacAccessWire.isSHA256(requestDigestSHA256),
              MacAccessWire.isSHA256(bindingFingerprintSHA256),
              MacAccessWire.isSHA256(envelopeDigestSHA256),
              policyEpoch >= 0, ttl > 0, ttl <= 60
        else { throw MacAccessPolicyCustodyError.invalidRequest }
        pruneExpiredApprovals()
        let previous = document
        document.approvals.removeAll { $0.commandID == commandID }
        document.approvals.append(MacAccessStoredApproval(
            commandID: commandID,
            capability: capability,
            requestDigestSHA256: requestDigestSHA256,
            bindingFingerprintSHA256: bindingFingerprintSHA256,
            policyEpoch: policyEpoch,
            envelopeDigestSHA256: envelopeDigestSHA256,
            expiresAt: now().addingTimeInterval(ttl)
        ))
        if document.approvals.count > Self.maximumApprovals {
            document.approvals.removeFirst(document.approvals.count - Self.maximumApprovals)
        }
        do { try persist() }
        catch { document = previous; throw error }
    }

    func consumeApproval(envelope: [String: JSONValue]) throws -> String? {
        pruneExpiredApprovals()
        guard let scope = try? Self.actionScope(envelope) else { return "approval_denied" }
        guard let index = document.approvals.firstIndex(where: {
            $0.commandID == scope.commandID
                && $0.capability == scope.capability
                && $0.requestDigestSHA256 == scope.requestDigest
                && $0.bindingFingerprintSHA256 == scope.bindingFingerprint
                && $0.policyEpoch == scope.policyEpoch
                && $0.envelopeDigestSHA256 == scope.envelopeDigest
                && $0.expiresAt > now()
        }) else {
            try persist()
            return "approval_denied"
        }
        document.approvals.remove(at: index)
        try persist()
        return nil
    }

    func awaitApproval(envelope: [String: JSONValue], ttl: TimeInterval = 60) async throws -> String? {
        guard pendingApproval == nil, pendingContinuation == nil,
              ttl > 0, ttl <= 60, let scope = try? Self.actionScope(envelope)
        else { return "approval_denied" }
        let approval = MacAccessXPCApproval(
            commandID: scope.commandID,
            capability: scope.capability,
            requestDigestSHA256: scope.requestDigest,
            bindingFingerprintSHA256: scope.bindingFingerprint,
            policyEpoch: scope.policyEpoch,
            envelopeDigestSHA256: scope.envelopeDigest,
            ttlSeconds: Int(ttl)
        )
        pendingApproval = MacAccessXPCPendingApproval(
            approval: approval,
            expiresAt: now().addingTimeInterval(ttl),
            targetX: envelope["command"]?.object?["request"]?.object?["x"]?.number ?? -1,
            targetY: envelope["command"]?.object?["request"]?.object?["y"]?.number ?? -1,
            deviceID: envelope["binding"]?.object?["device_id"]?.string ?? "unknown-device"
        )
        let allowed = await withCheckedContinuation { continuation in
            pendingContinuation = continuation
            Task { [commandID = scope.commandID] in
                try? await Task.sleep(for: .seconds(ttl))
                self.expirePendingApproval(commandID: commandID)
            }
        }
        return allowed ? nil : "approval_denied"
    }

    func currentPendingApproval() -> MacAccessXPCPendingApproval? {
        guard let pendingApproval, pendingApproval.expiresAt > now() else {
            cancelPendingApproval()
            return nil
        }
        return pendingApproval
    }

    func resolvePendingApproval(_ approval: MacAccessXPCApproval, allow: Bool) -> Bool {
        guard let pending = pendingApproval, pending.expiresAt > now(),
              pending.approval == approval
        else { return false }
        pendingApproval = nil
        let continuation = pendingContinuation
        pendingContinuation = nil
        continuation?.resume(returning: allow)
        return true
    }

    func authorizeNative(envelope: [String: JSONValue]) throws {
        nativeAuthorizationDigestSHA256 = try Self.actionScope(envelope).envelopeDigest
        nativeDecisionAuditDigestSHA256 = nil
    }

    func markAllowedDecisionCommitted(envelope: [String: JSONValue]) -> Bool {
        guard let digest = try? Self.actionScope(envelope).envelopeDigest,
              digest == nativeAuthorizationDigestSHA256
        else { return false }
        nativeDecisionAuditDigestSHA256 = digest
        return true
    }

    func authorizeLocalMode(_ mode: String) throws {
        guard mode == "ask_every_time" || mode == "full_access" else {
            throw MacAccessPolicyCustodyError.invalidRequest
        }
        locallyAuthorizedMode = mode
    }

    func openNativeBarrierIfAllowed() -> Bool {
        let projection = projectStatus()
        nativeBarrierOpen = projection.pairing == "paired"
            && projection.transport == "connected"
            && !projection.paused
            && !projection.killSwitch
            && projection.effectiveMode != "off"
            && (locallyAuthorizedMode == projection.effectiveMode
                || (locallyAuthorizedMode == "full_access"
                    && projection.configuredMode == "full_access"
                    && projection.effectiveMode == "ask_every_time"))
        return nativeBarrierOpen
    }

    func closeNativeBarrierAndInvalidatePending() {
        nativeBarrierOpen = false
        nativeAuthorizationDigestSHA256 = nil
        nativeDecisionAuditDigestSHA256 = nil
        cancelPendingApproval()
    }

    func consumeNativeAuthorization(envelope: [String: JSONValue]) -> Bool {
        let projection = projectStatus()
        guard nativeBarrierOpen, !projection.paused, !projection.killSwitch,
              projection.effectiveMode != "off",
              let digest = try? Self.actionScope(envelope).envelopeDigest,
              digest == nativeAuthorizationDigestSHA256,
              digest == nativeDecisionAuditDigestSHA256
        else { return false }
        nativeAuthorizationDigestSHA256 = nil
        nativeDecisionAuditDigestSHA256 = nil
        return true
    }

    func confirmFullAccess(policyEpoch: Int64) throws {
        guard policyEpoch >= 0 else { throw MacAccessPolicyCustodyError.invalidRequest }
        let previous = document
        document.fullAccessConfirmationEpoch = policyEpoch
        do { try persist() }
        catch { document = previous; throw error }
    }

    func hasFullAccessConfirmation(state: [String: JSONValue]) -> Bool {
        guard let epoch = state["policy_epoch"]?.integer else { return false }
        return document.fullAccessConfirmationEpoch == epoch
    }

    func burnReplay(envelope: [String: JSONValue]) throws -> Bool {
        guard let scope = try? Self.actionScope(envelope),
              let nonce = envelope["nonce"]?.string,
              nonce.utf8.count <= 16_384
        else { return false }
        let tombstone = "\(scope.commandID):\(nonce):\(scope.requestDigest)"
        guard !document.replayTombstones.contains(tombstone) else { return false }
        let previous = document
        document.replayTombstones.append(tombstone)
        if document.replayTombstones.count > Self.maximumReplayTombstones {
            document.replayTombstones.removeFirst(
                document.replayTombstones.count - Self.maximumReplayTombstones
            )
        }
        do { try persist() }
        catch { document = previous; throw error }
        return true
    }

    func invalidateAuthorityAndPersist() throws {
        let previous = document
        invalidateAuthority()
        do { try persist() }
        catch { document = previous; throw error }
    }

    private func invalidateAuthority() {
        document.approvals.removeAll()
        document.fullAccessConfirmationEpoch = nil
        nativeAuthorizationDigestSHA256 = nil
        nativeDecisionAuditDigestSHA256 = nil
        nativeBarrierOpen = false
        cancelPendingApproval()
    }

    private func pruneExpiredApprovals() {
        let instant = now()
        document.approvals.removeAll { $0.expiresAt <= instant }
    }

    private func persist() throws {
        try Self.persist(document, to: paths.custody, fileManager: fileManager)
    }

    private func advanceRevision() {
        let revision = document.state["revision"]?.integer ?? 0
        document.state["revision"] = .integer(min(9_007_199_254_740_991, revision + 1))
    }

    private static func prepareDirectory(_ url: URL, fileManager: FileManager) throws {
        try fileManager.createDirectory(at: url, withIntermediateDirectories: true)
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
    }

    private static func persist(
        _ value: MacAccessCustodyDocument,
        to url: URL,
        fileManager: FileManager
    ) throws {
        let data = try JSONEncoder().encode(value)
        try data.write(to: url, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    private static func pristineDocument(hostSessionID: String) -> MacAccessCustodyDocument {
        MacAccessCustodyDocument(
            state: baseState(hostSessionID: hostSessionID, failClosed: false),
            approvals: [], replayTombstones: [], fullAccessConfirmationEpoch: nil
        )
    }

    private static func failClosedDocument(hostSessionID: String) -> MacAccessCustodyDocument {
        MacAccessCustodyDocument(
            state: baseState(hostSessionID: hostSessionID, failClosed: true),
            approvals: [], replayTombstones: [], fullAccessConfirmationEpoch: nil
        )
    }

    private static func baseState(hostSessionID: String, failClosed: Bool) -> [String: JSONValue] {
        [
            "revision": .integer(0),
            "host_session_id": .string(hostSessionID),
            "last_sequence": .integer(0),
            "policy_epoch": .integer(failClosed ? 1 : 0),
            "runtime_instance_id": .null,
            "pairing_state": .string(failClosed ? "revoked" : "unpaired"),
            "configured_mode": .string("off"),
            "effective_mode": .string("off"),
            "requested_target_mode": .null,
            "paused": .boolean(failClosed),
            "kill_switch": .boolean(failClosed),
            "selected_binding": .null,
            "transport_state": .string(failClosed ? "blocked" : "disconnected"),
            "shutdown": .boolean(false),
            "local_confirmation_required": .boolean(false),
            "confirmed_runtime_instance_id": .null,
            "confirmed_policy_epoch": .null,
            "confirmed_binding_fingerprint_sha256": .null,
        ]
    }

    private func expirePendingApproval(commandID: String) {
        guard pendingApproval?.approval.commandID == commandID,
              pendingApproval?.expiresAt ?? .distantFuture <= now()
        else { return }
        cancelPendingApproval()
    }

    private func cancelPendingApproval() {
        pendingApproval = nil
        let continuation = pendingContinuation
        pendingContinuation = nil
        continuation?.resume(returning: false)
    }

    private static func actionScope(_ envelope: [String: JSONValue]) throws -> (
        commandID: String, capability: String, requestDigest: String,
        bindingFingerprint: String, policyEpoch: Int64, envelopeDigest: String
    ) {
        guard let commandID = envelope["command_id"]?.string,
              let policyEpoch = envelope["policy_epoch"]?.integer,
              let command = envelope["command"]?.object,
              let capability = command["capability"]?.string,
              let requestDigest = command["request_digest_sha256"]?.string,
              let binding = envelope["binding"]?.object,
              let bindingFingerprint = binding["binding_fingerprint_sha256"]?.string
        else { throw MacAccessPolicyCustodyError.invalidRequest }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let digest = MacAccessWire.sha256Hex(try encoder.encode(JSONValue.object(envelope)))
        return (commandID, capability, requestDigest, bindingFingerprint, policyEpoch, digest)
    }
}

struct MacAccessPolicyProjection: Equatable, Sendable {
    let pairing: String
    let configuredMode: String
    let effectiveMode: String
    let paused: Bool
    let killSwitch: Bool
    let policyEpoch: Int64
    let transport: String
}

struct MacAccessAuditAnchor: Codable, Equatable, Sendable {
    let sequence: Int64
    let recordSHA256: String
    let oldestSequence: Int64
    let oldestPreviousRecordSHA256: String?
}

protocol MacAccessAuditAnchorStore: Sendable {
    func load() async throws -> MacAccessAuditAnchor?
    func save(_ anchor: MacAccessAuditAnchor) async throws
}

private actor SecurityMacAccessAuditAnchorStore: MacAccessAuditAnchorStore {
    private let policy = MacAccessKeychainPolicy.currentBuildEpochOne
    private let service = "com.evaos.mac-access.audit-anchor"
    private let account = "audit-chain-v1"

    func load() throws -> MacAccessAuditAnchor? {
        var query = baseQuery
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let anchor = try? JSONDecoder().decode(MacAccessAuditAnchor.self, from: data)
        else { throw MacAccessPolicyCustodyError.auditCorrupt }
        return anchor
    }

    func save(_ anchor: MacAccessAuditAnchor) throws {
        let data = try JSONEncoder().encode(anchor)
        let update = [kSecValueData as String: data]
        let status = SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else {
            throw MacAccessPolicyCustodyError.persistenceUnavailable
        }
        var item = baseQuery
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
            throw MacAccessPolicyCustodyError.persistenceUnavailable
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccessGroup as String: policy.accessGroup,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }
}

actor MacAccessAuditCustody {
    private static let maximumFileBytes = 128 * 1_024
    private static let maximumArchives = 2

    private let paths: MacAccessPolicyPaths
    private let fileManager: FileManager
    private let now: @Sendable () -> Date
    private let anchorStore: (any MacAccessAuditAnchorStore)?

    init(
        paths: MacAccessPolicyPaths,
        fileManager: FileManager = .default,
        anchorStore: (any MacAccessAuditAnchorStore)? = nil,
        now: @escaping @Sendable () -> Date = Date.init
    ) throws {
        self.paths = paths
        self.fileManager = fileManager
        self.anchorStore = anchorStore
        self.now = now
        try fileManager.createDirectory(at: paths.directory, withIntermediateDirectories: true)
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: paths.directory.path)
    }

    static func production(paths: MacAccessPolicyPaths) throws -> MacAccessAuditCustody {
        try MacAccessAuditCustody(
            paths: paths, anchorStore: SecurityMacAccessAuditAnchorStore()
        )
    }

    func anchorHealthy() async -> Bool {
        guard let events = try? readEvents() else { return false }
        return await anchorMatches(events)
    }

    func committedCursor() async -> [String: JSONValue]? {
        guard let events = try? readEvents(), await anchorMatches(events),
              let event = events.last,
              let sequence = event["sequence"], let digest = event["record_sha256"]
        else { return nil }
        return ["sequence": sequence, "record_sha256": digest]
    }

    func eventCount() async -> Int {
        guard let events = try? readEvents(), await anchorMatches(events) else { return 0 }
        return events.count
    }

    func containsCommittedAuditID(_ auditID: String) async -> Bool {
        guard MacAccessWire.isIdentifier(auditID),
              let events = try? readEvents(), await anchorMatches(events)
        else { return false }
        return events.contains { $0["audit_id"]?.string == auditID }
    }

    func recentSafeEvents(limit: Int = 5) async -> [MacAccessXPCAuditEvent] {
        guard (1...10).contains(limit), let events = try? readEvents(),
              await anchorMatches(events)
        else { return [] }
        return Array(events.suffix(limit).compactMap { event in
            guard let occurred = event["occurred_at"]?.string.flatMap(Self.date),
                  let outcome = event["outcome"]?.string,
                  let reason = event["reason_code"]?.string,
                  let capability = event["evidence"]?.object?["capability"]?.string
            else { return nil }
            return MacAccessXPCAuditEvent(
                occurredAt: occurred, capability: capability, outcome: outcome, reasonCode: reason
            )
        }.reversed())
    }

    func append(
        envelope: [String: JSONValue],
        accessMode: String,
        allowed: Bool? = nil,
        decision: [String: JSONValue]? = nil,
        outcome: String? = nil,
        reasonCode: String,
        detailCode: String?
    ) async throws -> [String: JSONValue] {
        let existing = try readEvents()
        guard await anchorMatches(existing) else { throw MacAccessPolicyCustodyError.auditCorrupt }
        let previous = existing.last
        let sequence = (previous?["sequence"]?.integer ?? 0) + 1
        let command = envelope["command"]?.object ?? [:]
        let binding = envelope["binding"]?.object ?? [:]
        let isDecision = decision == nil
        let eventOutcome = outcome ?? (allowed == true ? "allowed" : "denied")
        let eventType = isDecision ? "command_decision" : "command_result"
        let auditID = "audit-\(UUID().uuidString.lowercased())"
        var evidence: [String: JSONValue] = [
            "capability": command["capability"] ?? .null,
            "redaction_policy": .string("default_v1"),
        ]
        if let detailCode { evidence["detail_code"] = .string(detailCode) }
        var event: [String: JSONValue] = [
            "schema_version": .string("evaos.mac_access.audit_event.v1"),
            "audit_id": .string(auditID),
            "sequence": .integer(sequence),
            "previous_record_sha256": previous?["record_sha256"] ?? .null,
            "occurred_at": .string(Self.instant(now())),
            "event_type": .string(eventType),
            "actor": .object(["kind": .string("system"), "identity": .string("policy_engine")]),
            "binding_fingerprint_sha256": binding["binding_fingerprint_sha256"] ?? .null,
            "command_id": envelope["command_id"] ?? .null,
            "request_digest_sha256": command["request_digest_sha256"] ?? .null,
            "causation_audit_id": decision?["audit_id"] ?? .null,
            "access_mode": .string(accessMode),
            "outcome": .string(eventOutcome),
            "reason_code": .string(reasonCode),
            "evidence": .object(evidence),
            "record_sha256": .string(String(repeating: "0", count: 64)),
        ]
        event["record_sha256"] = .string(try Self.digest(event))
        try rotateIfNeeded(adding: try JSONEncoder().encode(JSONValue.object(event)).count + 1)
        let line = try JSONEncoder().encode(JSONValue.object(event)) + Data([0x0a])
        if !fileManager.fileExists(atPath: paths.audit.path) {
            _ = fileManager.createFile(atPath: paths.audit.path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: paths.audit)
        try handle.seekToEnd()
        try handle.write(contentsOf: line)
        try handle.synchronize()
        try handle.close()
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: paths.audit.path)
        if let anchorStore {
            let committed = try readEvents()
            guard let first = committed.first, let last = committed.last,
                  let sequence = last["sequence"]?.integer,
                  let digest = last["record_sha256"]?.string,
                  let oldestSequence = first["sequence"]?.integer
            else { throw MacAccessPolicyCustodyError.auditCorrupt }
            try await anchorStore.save(MacAccessAuditAnchor(
                sequence: sequence,
                recordSHA256: digest,
                oldestSequence: oldestSequence,
                oldestPreviousRecordSHA256: first["previous_record_sha256"]?.string
            ))
        }
        return event
    }

    func summary(after cursor: [String: JSONValue]?, limit: Int) async throws -> [String: JSONValue] {
        guard (1...100).contains(limit) else { throw MacAccessPolicyCustodyError.invalidRequest }
        let events = try readEvents()
        guard await anchorMatches(events) else { throw MacAccessPolicyCustodyError.auditCorrupt }
        let afterSequence = cursor?["sequence"]?.integer ?? 0
        let page = Array(events.filter { ($0["sequence"]?.integer ?? 0) > afterSequence }.prefix(limit))
        let next = page.last.map { event in
            JSONValue.object([
                "sequence": event["sequence"] ?? .integer(0),
                "record_sha256": event["record_sha256"] ?? .string(String(repeating: "0", count: 64)),
            ])
        } ?? .null
        var causal: [JSONValue] = []
        if let cursor, let digest = cursor["record_sha256"]?.string,
           let event = events.first(where: { $0["record_sha256"]?.string == digest }),
           event["event_type"]?.string == "command_decision" {
            causal = [.object(event)]
        }
        return [
            "kind": .string("audit_summary"),
            "page_anchor": cursor.map(JSONValue.object) ?? .null,
            "events": .array(page.map(JSONValue.object)),
            "causal_decisions": .array(causal),
            "next_cursor": next,
        ]
    }

    private func readEvents() throws -> [[String: JSONValue]] {
        var events: [[String: JSONValue]] = []
        for url in archiveURLs().reversed() + [paths.audit] where fileManager.fileExists(atPath: url.path) {
            let data = try Data(contentsOf: url)
            for line in data.split(separator: 0x0a) where !line.isEmpty {
                guard case .object(let event) = try JSONDecoder().decode(JSONValue.self, from: Data(line)),
                      event["record_sha256"]?.string == (try Self.digest(event))
                else { throw MacAccessPolicyCustodyError.auditCorrupt }
                if let previous = events.last {
                    guard event["sequence"]?.integer == (previous["sequence"]?.integer ?? 0) + 1,
                          event["previous_record_sha256"]?.string == previous["record_sha256"]?.string
                    else { throw MacAccessPolicyCustodyError.auditCorrupt }
                }
                events.append(event)
            }
        }
        return events
    }

    private func anchorMatches(_ events: [[String: JSONValue]]) async -> Bool {
        guard let anchorStore else { return true }
        do {
            guard let anchor = try await anchorStore.load() else { return events.isEmpty }
            guard let first = events.first, let last = events.last else { return false }
            return first["sequence"]?.integer == anchor.oldestSequence
                && first["previous_record_sha256"]?.string == anchor.oldestPreviousRecordSHA256
                && last["sequence"]?.integer == anchor.sequence
                && last["record_sha256"]?.string == anchor.recordSHA256
        } catch {
            return false
        }
    }

    private func rotateIfNeeded(adding bytes: Int) throws {
        let current = (try? fileManager.attributesOfItem(atPath: paths.audit.path)[.size] as? Int) ?? 0
        guard current + bytes > Self.maximumFileBytes, current > 0 else { return }
        let archives = archiveURLs()
        if fileManager.fileExists(atPath: archives.last!.path) {
            try fileManager.removeItem(at: archives.last!)
        }
        if Self.maximumArchives > 1 {
            for index in stride(from: Self.maximumArchives - 1, through: 1, by: -1) {
                let source = archives[index - 1]
                let target = archives[index]
                if fileManager.fileExists(atPath: source.path) {
                    try fileManager.moveItem(at: source, to: target)
                }
            }
        }
        try fileManager.moveItem(at: paths.audit, to: archives[0])
    }

    private func archiveURLs() -> [URL] {
        (1...Self.maximumArchives).map { paths.directory.appendingPathComponent("audit.ndjson.\($0)") }
    }

    private static func digest(_ event: [String: JSONValue]) throws -> String {
        var unsigned = event
        unsigned.removeValue(forKey: "record_sha256")
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return SHA256.hash(data: try encoder.encode(JSONValue.object(unsigned)))
            .map { String(format: "%02x", $0) }.joined()
    }

    private static func instant(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

extension JSONValue {
    var string: String? { if case .string(let value) = self { value } else { nil } }
    var integer: Int64? { if case .integer(let value) = self { value } else { nil } }
    var number: Double? {
        switch self {
        case .number(let value): value
        case .integer(let value): Double(value)
        default: nil
        }
    }
    var boolean: Bool? { if case .boolean(let value) = self { value } else { nil } }
    var object: [String: JSONValue]? { if case .object(let value) = self { value } else { nil } }
    var array: [JSONValue]? { if case .array(let value) = self { value } else { nil } }
}
