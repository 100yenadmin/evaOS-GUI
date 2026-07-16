import CryptoKit
import Foundation

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
        var replacement = state
        replacement["revision"] = .integer(expectedRevision + 1)
        document.state = replacement
        try persist()
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
        try persist()
        return projectStatus()
    }

    func recordApproval(
        commandID: String,
        capability: String,
        requestDigestSHA256: String,
        bindingFingerprintSHA256: String,
        policyEpoch: Int64,
        ttl: TimeInterval
    ) throws {
        guard MacAccessWire.isIdentifier(commandID),
              capability == "customer_mac.desktop_click",
              MacAccessWire.isSHA256(requestDigestSHA256),
              MacAccessWire.isSHA256(bindingFingerprintSHA256),
              policyEpoch >= 0, ttl > 0, ttl <= 60
        else { throw MacAccessPolicyCustodyError.invalidRequest }
        pruneExpiredApprovals()
        document.approvals.removeAll { $0.commandID == commandID }
        document.approvals.append(MacAccessStoredApproval(
            commandID: commandID,
            capability: capability,
            requestDigestSHA256: requestDigestSHA256,
            bindingFingerprintSHA256: bindingFingerprintSHA256,
            policyEpoch: policyEpoch,
            expiresAt: now().addingTimeInterval(ttl)
        ))
        if document.approvals.count > Self.maximumApprovals {
            document.approvals.removeFirst(document.approvals.count - Self.maximumApprovals)
        }
        try persist()
    }

    func consumeApproval(envelope: [String: JSONValue]) throws -> String? {
        pruneExpiredApprovals()
        guard let scope = Self.actionScope(envelope) else { return "approval_denied" }
        guard let index = document.approvals.firstIndex(where: {
            $0.commandID == scope.commandID
                && $0.capability == scope.capability
                && $0.requestDigestSHA256 == scope.requestDigest
                && $0.bindingFingerprintSHA256 == scope.bindingFingerprint
                && $0.policyEpoch == scope.policyEpoch
                && $0.expiresAt > now()
        }) else {
            try persist()
            return "approval_denied"
        }
        document.approvals.remove(at: index)
        try persist()
        return nil
    }

    func confirmFullAccess(policyEpoch: Int64) throws {
        guard policyEpoch >= 0 else { throw MacAccessPolicyCustodyError.invalidRequest }
        document.fullAccessConfirmationEpoch = policyEpoch
        try persist()
    }

    func hasFullAccessConfirmation(state: [String: JSONValue]) -> Bool {
        guard let epoch = state["policy_epoch"]?.integer else { return false }
        return document.fullAccessConfirmationEpoch == epoch
    }

    func burnReplay(envelope: [String: JSONValue]) throws -> Bool {
        guard let scope = Self.actionScope(envelope),
              let nonce = envelope["nonce"]?.string,
              nonce.utf8.count <= 16_384
        else { return false }
        let tombstone = "\(scope.commandID):\(nonce):\(scope.requestDigest)"
        guard !document.replayTombstones.contains(tombstone) else { return false }
        document.replayTombstones.append(tombstone)
        if document.replayTombstones.count > Self.maximumReplayTombstones {
            document.replayTombstones.removeFirst(
                document.replayTombstones.count - Self.maximumReplayTombstones
            )
        }
        try persist()
        return true
    }

    func invalidateAuthorityAndPersist() throws {
        invalidateAuthority()
        try persist()
    }

    private func invalidateAuthority() {
        document.approvals.removeAll()
        document.fullAccessConfirmationEpoch = nil
    }

    private func pruneExpiredApprovals() {
        let instant = now()
        document.approvals.removeAll { $0.expiresAt <= instant }
    }

    private func persist() throws {
        try Self.persist(document, to: paths.custody, fileManager: fileManager)
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

    private static func actionScope(_ envelope: [String: JSONValue]) -> (
        commandID: String, capability: String, requestDigest: String,
        bindingFingerprint: String, policyEpoch: Int64
    )? {
        guard let commandID = envelope["command_id"]?.string,
              let policyEpoch = envelope["policy_epoch"]?.integer,
              let command = envelope["command"]?.object,
              let capability = command["capability"]?.string,
              let requestDigest = command["request_digest_sha256"]?.string,
              let binding = envelope["binding"]?.object,
              let bindingFingerprint = binding["binding_fingerprint_sha256"]?.string
        else { return nil }
        return (commandID, capability, requestDigest, bindingFingerprint, policyEpoch)
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

actor MacAccessAuditCustody {
    private static let maximumFileBytes = 128 * 1_024
    private static let maximumArchives = 2

    private let paths: MacAccessPolicyPaths
    private let fileManager: FileManager
    private let now: @Sendable () -> Date

    init(
        paths: MacAccessPolicyPaths,
        fileManager: FileManager = .default,
        now: @escaping @Sendable () -> Date = Date.init
    ) throws {
        self.paths = paths
        self.fileManager = fileManager
        self.now = now
        try fileManager.createDirectory(at: paths.directory, withIntermediateDirectories: true)
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: paths.directory.path)
    }

    func anchorHealthy() -> Bool { (try? readEvents()) != nil }

    func committedCursor() -> [String: JSONValue]? {
        guard let event = try? readEvents().last,
              let sequence = event["sequence"], let digest = event["record_sha256"]
        else { return nil }
        return ["sequence": sequence, "record_sha256": digest]
    }

    func eventCount() -> Int { (try? readEvents().count) ?? 0 }

    func append(
        envelope: [String: JSONValue],
        accessMode: String,
        allowed: Bool? = nil,
        decision: [String: JSONValue]? = nil,
        outcome: String? = nil,
        reasonCode: String,
        detailCode: String?
    ) throws -> [String: JSONValue] {
        let existing = try readEvents()
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
        try handle.close()
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: paths.audit.path)
        return event
    }

    func summary(after cursor: [String: JSONValue]?, limit: Int) throws -> [String: JSONValue] {
        guard (1...100).contains(limit) else { throw MacAccessPolicyCustodyError.invalidRequest }
        let events = try readEvents()
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
