import Foundation

struct MacAccessAdapterProcessResult: Equatable, Sendable {
    let exitCode: Int32
    let standardOutput: Data
    let timedOut: Bool
}

protocol MacAccessAdapterRunning: Sendable {
    func run(input: Data) async -> MacAccessAdapterProcessResult
}

struct MacAccessAdapterEnvelope: Encodable, Sendable {
    let capability: String
    let request: [String: JSONValue]
}

private struct MacAccessAdapterReply: Decodable, Sendable {
    let schemaVersion: String
    let auditID: String
    let ok: Bool
    let errorCode: String?
    let data: [String: JSONValue]

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case auditID = "audit_id"
        case ok
        case errorCode = "error_code"
        case data
    }
}

struct BundledMacAccessAdapterRunner: MacAccessAdapterRunning {
    static let maximumOutputBytes = 4 << 20
    static let timeoutNanoseconds: UInt64 = 30_000_000_000

    let runtimeRoot: URL
    let stateRoot: URL

    init(
        runtimeRoot: URL = Bundle.main.resourceURL!.appendingPathComponent("MacAccessRuntime"),
        stateRoot: URL? = nil
    ) {
        self.runtimeRoot = runtimeRoot
        self.stateRoot = stateRoot ?? FileManager.default
            .homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/evaOS Mac Access/Adapter", isDirectory: true)
    }

    func run(input: Data) async -> MacAccessAdapterProcessResult {
        let runtimePath = runtimeRoot.path
        let statePath = stateRoot.path
        return await Task.detached(priority: .userInitiated) {
            let python = URL(fileURLWithPath: runtimePath)
                .appendingPathComponent("python/bin/python3")
            let runner = URL(fileURLWithPath: runtimePath)
                .appendingPathComponent("mac_access_adapter_runner.py")
            let source = URL(fileURLWithPath: runtimePath)
                .appendingPathComponent("src")
            let cuaDriver = URL(fileURLWithPath: runtimePath)
                .appendingPathComponent("bin/cua-driver")
            guard FileManager.default.isExecutableFile(atPath: python.path),
                  FileManager.default.fileExists(atPath: runner.path),
                  FileManager.default.isExecutableFile(atPath: cuaDriver.path)
            else {
                return MacAccessAdapterProcessResult(
                    exitCode: 127, standardOutput: Data(), timedOut: false
                )
            }
            do {
                try FileManager.default.createDirectory(
                    atPath: statePath,
                    withIntermediateDirectories: true,
                    attributes: [.posixPermissions: 0o700]
                )
            } catch {
                return MacAccessAdapterProcessResult(
                    exitCode: 126, standardOutput: Data(), timedOut: false
                )
            }

            let process = Process()
            let standardInput = Pipe()
            let standardOutput = Pipe()
            process.executableURL = python
            process.arguments = ["-I", "-B", runner.path]
            process.standardInput = standardInput
            process.standardOutput = standardOutput
            process.standardError = FileHandle.nullDevice
            process.environment = [
                "HOME": FileManager.default.homeDirectoryForCurrentUser.path,
                "PATH": "\(runtimePath)/bin:/usr/bin:/bin:/usr/sbin:/sbin",
                "PYTHONDONTWRITEBYTECODE": "1",
                "PYTHONNOUSERSITE": "1",
                "CUA_DRIVER_EMBEDDED": "1",
                "CUA_DRIVER_RS_TELEMETRY_ENABLED": "false",
                "CUA_DRIVER_RS_UPDATE_CHECK": "false",
                "EVAOS_MAC_ACCESS_BRIDGE_SOURCE": source.path,
                "EVAOS_MAC_ACCESS_CUA_DRIVER_BIN": cuaDriver.path,
                "EVAOS_MAC_ACCESS_STATE_DIR": statePath,
            ]
            do {
                try process.run()
            } catch {
                return MacAccessAdapterProcessResult(
                    exitCode: 127, standardOutput: Data(), timedOut: false
                )
            }

            standardInput.fileHandleForWriting.write(input)
            try? standardInput.fileHandleForWriting.close()
            let timeoutTask = Task {
                try? await Task.sleep(nanoseconds: Self.timeoutNanoseconds)
                if !Task.isCancelled, process.isRunning {
                    process.terminate()
                }
            }
            let output = standardOutput.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            let timedOut = !timeoutTask.isCancelled && process.terminationStatus == SIGTERM
            timeoutTask.cancel()
            return MacAccessAdapterProcessResult(
                exitCode: process.terminationStatus,
                standardOutput: output.prefix(Self.maximumOutputBytes + 1),
                timedOut: timedOut
            )
        }.value
    }
}

struct MacAccessBridgeCommandExecutor: MacAccessCommandExecutor {
    private let runner: any MacAccessAdapterRunning

    init(runner: any MacAccessAdapterRunning = BundledMacAccessAdapterRunner()) {
        self.runner = runner
    }

    func execute(
        capability: String,
        request: [String: JSONValue]
    ) async -> MacAccessExecutionResult {
        let fallbackAuditID = "mac-access-\(UUID().uuidString.lowercased())"
        guard let input = try? JSONEncoder().encode(
            MacAccessAdapterEnvelope(capability: capability, request: request)
        ), input.count <= 64 << 10
        else {
            return MacAccessExecutionResult(
                localAuditID: fallbackAuditID,
                outcome: .denied,
                errorCode: "request_invalid"
            )
        }
        let processResult = await runner.run(input: input)
        guard !processResult.timedOut else {
            return MacAccessExecutionResult(
                localAuditID: fallbackAuditID,
                outcome: .failed,
                errorCode: "adapter_timeout"
            )
        }
        guard processResult.exitCode == 0,
              processResult.standardOutput.count <= BundledMacAccessAdapterRunner.maximumOutputBytes,
              let reply = try? JSONDecoder().decode(
                  MacAccessAdapterReply.self,
                  from: processResult.standardOutput
              ),
              reply.schemaVersion == "evaos.mac_access.adapter_result.v1",
              MacAccessWire.isIdentifier(reply.auditID),
              reply.errorCode == nil || MacAccessWire.isIdentifier(reply.errorCode!)
        else {
            return MacAccessExecutionResult(
                localAuditID: fallbackAuditID,
                outcome: .failed,
                errorCode: "adapter_runtime_failed"
            )
        }
        return MacAccessExecutionResult(
            localAuditID: reply.auditID,
            outcome: reply.ok ? .executed : .failed,
            errorCode: reply.errorCode,
            result: reply.ok && capability == "customer_mac.desktop_see" ? reply.data : nil
        )
    }
}
