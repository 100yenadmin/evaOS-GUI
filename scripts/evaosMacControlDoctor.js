#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const installedProof = require('./evaosInstalledAppProductProof.js');
const { scanSecretEvidence } = require('./evaosShellSecretEvidenceAudit.js');

const REPORT_SCHEMA = 'evaos-mac-control-doctor/v1';
const DIAGNOSTIC_SCHEMA_VERSION = 'evaos.workbench.diagnostic_packet.v1';
const DEFAULT_ARTIFACT_BASE = '/Volumes/LEXAR/Codex/evidence/evaos-mac-control-doctor';
const DEFAULT_SUPPORT_ACCOUNT = 'admin@electricsheephq.com';
const DEFAULT_SUPPORT_TARGET = 'Support VM';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_AGENT_PROOF_TIMEOUT_MS = 180_000;
const MAX_COMMAND_OUTPUT = 8_000;

const GATE_IDS = [
  'installed_app_preflight',
  'computer_use_evidence',
  'support_account_target',
  'route_visibility',
  'mac_control_cold_start',
  'bridge_ready',
  'visible_agent_mac_tools',
  'local_openclaw',
  'vm_openclaw',
  'hermes',
  'stop_revoke',
  'kill_switch',
  'post_reset_recovery',
];

const ROUTE_MARKERS = [
  'evaOS',
  'Hermes',
  'Mission Control',
  'Shared Browser',
  'Terminal',
  'Connected Apps',
  'People & Access',
  'Company Brain',
  'Mac & iPhone',
];

const REQUIRED_VISIBLE_AGENT_MAC_TOOLS = [
  'customer_mac_status',
  'customer_mac_capabilities',
  'desktop_control_status',
  'desktop_see',
  'desktop_bridge_audit_tail',
  'desktop_control_stop',
  'desktop_kill_switch',
];
const VISIBLE_AGENT_LOW_IMPACT_ACTION = 'approved_low_impact_action';

const VISIBLE_AGENT_MAC_TOOL_PROMPT = [
  'Release proof: call the active evaOS/OpenClaw Mac-control tools for this selected Workbench target.',
  '',
  'Required tools:',
  ...REQUIRED_VISIBLE_AGENT_MAC_TOOLS.map((tool) => `- ${tool}`),
  `- ${VISIBLE_AGENT_LOW_IMPACT_ACTION}: one approved low-impact desktop action with lowImpact=true and approved=true`,
  '',
  'Return a compact JSON structured proof with toolResults[], each tool name, ok/status, result data, and any audit id.',
  'Do not ask for pairing codes, connection details, network endpoints, remote-shell details, browser-debug details, or tailnet keys.',
].join('\n');

const VISIBLE_AGENT_FAILURE_PATTERN =
  /USER_AGENT_STARTUP_FAILED|agent type is no longer supported|selected agent failed to start|transport parse error|Invalid message \{|ACP parse|parse ACP|could not parse|Doctor warnings|Left plugin install index|broker-boundary|generic broker-boundary failure|mac_connector_material_missing/i;
const OS_PERMISSION_PROMPT_PATTERN =
  /"?(?:node|osascript|System Events)"?\s+wants access to control\s+"?System Events"?|System Events.*would like to control/i;
const FORBIDDEN_PROOF_COMMAND_PATTERN =
  /(?:^|[\s;&|()])(?:node|nodejs|osascript|osascript\.app|open\s+-a\s+Script\s+Editor|swift|python(?:3)?|ruby|perl)\b|System Events|AXUIElement|CGEvent|cliclick|xdotool|screencapture|screenrecord|ffmpeg|Chrome DevTools|--remote-debugging-port/i;
const APPROVED_PROOF_EXECUTABLES = new Set([
  'openclaw',
  'hermes',
  'evaos-desktop-bridge',
  'mac-control-doctor',
  'support-control',
  'evaos-support',
  'evaos-support.sh',
]);
const APPROVED_PROOF_EXECUTABLE_PREFIXES = ['customer_mac_', 'desktop_control', 'desktop_see', 'desktop_bridge'];
const VISIBLE_AGENT_SUCCESS_STATUSES = new Set(['ok', 'passed', 'succeeded', 'success', 'ready', 'completed', 'done']);
const PROOF_FAILURE_STATUSES = new Set([
  'denied',
  'error',
  'failed',
  'failure',
  'not_ready',
  'rejected',
  'repair_required',
]);
const FAIL_CLOSED_STATUSES = new Set(['fail_closed', 'failed_closed', 'closed', 'blocked', 'revoked']);
const BRIDGE_TRUTH_REASON_CODES = new Set([
  'connector_service_not_running',
  'connector_service_unreachable',
  'control_kill_switch_active',
  'missing_live_listener',
  'stale_bridge_owner',
  'token_missing',
]);
const VISIBLE_AGENT_TOOL_ARRAY_KEYS = ['toolResults', 'tool_results', 'toolCalls', 'tool_calls', 'results', 'calls'];
const DEFAULT_PROOF_AGENT_SELECTORS = [
  '[data-agent-pill="true"][data-agent-key="openclaw-gateway"]',
  '[data-agent-pill="true"][data-agent-key="openclaw"]',
  '[data-agent-pill="true"][data-agent-type="openclaw-gateway"]',
  '[data-agent-pill="true"][data-agent-type="openclaw"]',
];

const SENSITIVE_KEY_PATTERN =
  /(authorization|bearer|token|secret|password|credential|desktop[_-]?session|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|service[_-]?role|provider[_-]?grant|grant[_-]?handle|client[_-]?secret|connector[_-]?url|connector[_-]?token|headscale|tailscale|preauth)/i;
const KEY_VALUE_SECRET_PATTERN =
  /\b([A-Za-z0-9_.-]*(?:authorization|bearer|token|secret|password|credential|desktop[_-]?session|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|service[_-]?role|provider[_-]?grant|grant[_-]?handle|client[_-]?secret|connector[_-]?url|connector[_-]?token|headscale|tailscale|preauth)[A-Za-z0-9_.-]*)\b(\s*[:=]\s*)(["']?)([^"'\s,&}]{3,})(\3)/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}\b/gi;
const EVAOS_SESSION_PATTERN = /\b(?:eds|epg)_[A-Za-z0-9._-]{6,}\b/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const URL_PATTERN = /https?:\/\/[^\s"')]+/gi;
const IP_PORT_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?::\d{2,5})?\b/g;
const LOCALHOST_PATTERN = /\b(?:localhost|127\.0\.0\.1)(?::\d{2,5})?\b/gi;
const FORBIDDEN_OUTPUT_PATTERN =
  /https?:\/\/|\b(?:\d{1,3}\.){3}\d{1,3}\b|localhost|127\.0\.0\.1|Bearer\s+|desktop_session|access_token|refresh_token|provider_grant|grant_handle|connector_url|connector_token|headscale|tailscale|preauth/i;

function shortHead(head) {
  return installedProof.shortHead
    ? installedProof.shortHead(head)
    : String(head || '')
        .trim()
        .slice(0, 12);
}

function gitHead(repoRoot = path.resolve(__dirname, '..')) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function artifactRootForHead(head, env = process.env) {
  if (env.EVAOS_MAC_CONTROL_DOCTOR_ROOT) {
    return env.EVAOS_MAC_CONTROL_DOCTOR_ROOT;
  }
  return path.join(DEFAULT_ARTIFACT_BASE, `current-head-${shortHead(head)}`, 'doctor');
}

function bridgePathForApp(appPath = installedProof.DEFAULT_APP_PATH) {
  return path.join(appPath, 'Contents', 'Resources', 'Bridge', 'evaos-desktop-bridge');
}

function sanitizeText(value) {
  return String(value ?? '')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(EVAOS_SESSION_PATTERN, '[REDACTED]')
    .replace(JWT_PATTERN, '[REDACTED]')
    .replace(
      KEY_VALUE_SECRET_PATTERN,
      (_match, key, separator, quote) => `${key}${separator}${quote}[REDACTED]${quote}`
    )
    .replace(URL_PATTERN, '[redacted-endpoint]')
    .replace(IP_PORT_PATTERN, '[redacted-endpoint]')
    .replace(LOCALHOST_PATTERN, '[redacted-endpoint]');
}

function sanitizeValue(value) {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeValue(entryValue),
      ])
    );
  }
  return value;
}

function textDigest(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 16);
}

function assertNoUnsafeDoctorOutput(value) {
  installedProof.assertNoUnsafeProofText(value);
  const secretFindings = scanSecretEvidence(value).filter(
    (finding) => !/\.redaction\.rawSecretsStoredInWorkbench$/.test(finding.path)
  );
  if (secretFindings.length > 0) {
    throw new Error(`Unsafe doctor output contains shell secret evidence at ${secretFindings[0].path}.`);
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (FORBIDDEN_OUTPUT_PATTERN.test(text)) {
    throw new Error('Unsafe doctor output contains endpoint, pairing, or connector material.');
  }
}

function commandSnippet(command) {
  if (!command) return undefined;
  return sanitizeText(command).slice(0, 240);
}

function makeGate(id, status, details = {}) {
  if (!GATE_IDS.includes(id)) {
    throw new Error(`Unknown mac-control doctor gate: ${id}`);
  }
  return sanitizeValue({
    id,
    status,
    reasonCode: details.reasonCode,
    message: details.message,
    command: commandSnippet(details.command),
    evidencePath: details.evidencePath,
    data: details.data,
  });
}

function pendingGate(id, message = 'Gate not run in dry-run mode.') {
  return makeGate(id, 'pending', { message });
}

function blockedGate(id, reasonCode, message, details = {}) {
  return makeGate(id, 'blocked', { ...details, reasonCode, message });
}

function passedGate(id, message, details = {}) {
  return makeGate(id, 'passed', { ...details, message });
}

function failedGate(id, reasonCode, message, details = {}) {
  return makeGate(id, 'failed', { ...details, reasonCode, message });
}

function runProofCommand(parsedCommand, options = {}) {
  const result = spawnSync(parsedCommand.executable, parsedCommand.args, {
    cwd: options.cwd || path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: options.timeout || DEFAULT_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      ...options.env,
      ...parsedCommand.env,
    },
  });

  return {
    status: result.status,
    signal: result.signal,
    stdout: sanitizeText(result.stdout || '').slice(0, MAX_COMMAND_OUTPUT),
    stderr: sanitizeText(result.stderr || '').slice(0, MAX_COMMAND_OUTPUT),
    error: result.error ? sanitizeText(result.error.message) : undefined,
  };
}

function summarizeCommandPayloads(payloads) {
  const entries = Array.isArray(payloads) ? payloads : [];
  return {
    payloadCount: entries.length,
    successPayloadCount: entries.filter(commandProofPayloadSucceeded).length,
    auditedSuccessPayloadCount: entries.filter(commandProofPayloadAuditedSuccess).length,
    explicitFailurePayloadCount: entries.filter(commandProofPayloadExplicitlyFailed).length,
    failClosedPayloadCount: entries.filter(commandProofPayloadFailsClosed).length,
  };
}

function summarizeProofCommandResult(result) {
  const stdout = String(result?.stdout || '');
  const stderr = String(result?.stderr || '');
  const payloads = commandProofPayloads(result || {});
  return sanitizeValue({
    status: result?.status,
    signal: result?.signal || undefined,
    error: result?.error ? '[REDACTED]' : undefined,
    stdoutDigest: stdout ? textDigest(stdout) : undefined,
    stderrDigest: stderr ? textDigest(stderr) : undefined,
    stdoutBytes: stdout ? Buffer.byteLength(stdout, 'utf8') : 0,
    stderrBytes: stderr ? Buffer.byteLength(stderr, 'utf8') : 0,
    payloadSummary: summarizeCommandPayloads(payloads),
  });
}

function shellWords(command) {
  return String(command || '').match(/(?:[^\s'"\\]+|"(?:\\.|[^"])*"|'[^']*')+/g) || [];
}

function unquoteShellWord(word) {
  const value = String(word || '').trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function proofCommandWordUnsupported(word) {
  return /[;&|()<>`]/.test(String(word || ''));
}

function parseProofCommand(command) {
  const words = shellWords(command);
  if (words.length === 0) return { ok: false, reasonCode: 'empty_proof_command' };

  const env = {};
  const args = [];
  let executable = '';
  let sawEnv = false;

  for (const rawWord of words) {
    const word = unquoteShellWord(rawWord);
    if (!word) continue;
    if (proofCommandWordUnsupported(word)) {
      return { ok: false, reasonCode: 'unsupported_proof_command_syntax' };
    }
    if (!executable && (word === 'env' || word === 'command')) {
      sawEnv = word === 'env';
      continue;
    }
    if (!executable && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      const separatorIndex = word.indexOf('=');
      env[word.slice(0, separatorIndex)] = word.slice(separatorIndex + 1);
      continue;
    }
    if (!executable && sawEnv && /^-/.test(word)) {
      continue;
    }
    if (!executable) {
      executable = word;
      continue;
    }
    args.push(word);
  }

  if (!executable) return { ok: false, reasonCode: 'empty_proof_command' };
  return { ok: true, executable, executableName: path.basename(executable), args, env };
}

function firstProofExecutable(command) {
  const parsed = parseProofCommand(command);
  return parsed.ok ? parsed.executableName : '';
}

function approvedProofExecutable(command) {
  const executable = typeof command === 'string' ? firstProofExecutable(command) : path.basename(command || '');
  if (!executable) return false;
  return (
    APPROVED_PROOF_EXECUTABLES.has(executable) ||
    APPROVED_PROOF_EXECUTABLE_PREFIXES.some((prefix) => executable.startsWith(prefix))
  );
}

function commandProofPayloads(result) {
  return [...payloadsFromVisibleAgentEvidence(result.stdout), ...payloadsFromVisibleAgentEvidence(result.stderr)];
}

function commandProofPayloadSucceeded(payload, depth = 0) {
  if (!payload || depth > 5) return false;
  if (Array.isArray(payload)) return payload.some((entry) => commandProofPayloadSucceeded(entry, depth + 1));
  if (typeof payload !== 'object') return false;
  if (commandProofPayloadExplicitlyFailed(payload)) return false;
  if (payload.ok === true || payload.success === true || payload.passed === true) return true;
  const status = payload.status || payload.outcome || payload.resultStatus || payload.result_status;
  if (typeof status === 'string' && VISIBLE_AGENT_SUCCESS_STATUSES.has(status.trim().toLowerCase())) return true;
  return Object.values(payload).some((value) => commandProofPayloadSucceeded(value, depth + 1));
}

function commandProofPayloadExplicitlyFailed(payload, depth = 0) {
  if (!payload || depth > 5) return false;
  if (Array.isArray(payload)) return payload.some((entry) => commandProofPayloadExplicitlyFailed(entry, depth + 1));
  if (typeof payload !== 'object') return false;
  if (payload.ok === false || payload.success === false || payload.passed === false) return true;
  const status = payload.status || payload.outcome || payload.resultStatus || payload.result_status;
  if (typeof status === 'string' && PROOF_FAILURE_STATUSES.has(status.trim().toLowerCase())) return true;
  return Object.values(payload).some((value) => commandProofPayloadExplicitlyFailed(value, depth + 1));
}

function commandProofPayloadHasAuditId(payload, depth = 0) {
  if (!payload || depth > 5) return false;
  if (Array.isArray(payload)) return payload.some((entry) => commandProofPayloadHasAuditId(entry, depth + 1));
  if (typeof payload !== 'object') return false;
  for (const key of [
    'auditId',
    'audit_id',
    'auditEventId',
    'audit_event_id',
    'auditRecordId',
    'audit_record_id',
    'eventId',
    'event_id',
  ]) {
    if (typeof payload[key] === 'string' && payload[key].trim()) return true;
  }
  return Object.values(payload).some((value) => commandProofPayloadHasAuditId(value, depth + 1));
}

function commandProofPayloadFailsClosed(payload, depth = 0) {
  if (!payload || depth > 5) return false;
  if (Array.isArray(payload)) return payload.some((entry) => commandProofPayloadFailsClosed(entry, depth + 1));
  if (typeof payload !== 'object') return false;
  if (
    payload.failClosed === false ||
    payload.fail_closed === false ||
    payload.killSwitch === false ||
    payload.kill_switch === false
  ) {
    return false;
  }
  if (
    payload.failClosed === true ||
    payload.fail_closed === true ||
    payload.killSwitch === true ||
    payload.kill_switch === true
  ) {
    return true;
  }
  const status = payload.status || payload.state || payload.outcome || payload.resultStatus || payload.result_state;
  if (typeof status === 'string' && FAIL_CLOSED_STATUSES.has(status.trim().toLowerCase())) return true;
  return Object.values(payload).some((value) => commandProofPayloadFailsClosed(value, depth + 1));
}

function commandProofPayloadAuditedSuccess(payload) {
  return (
    commandProofPayloadSucceeded(payload) &&
    commandProofPayloadHasAuditId(payload) &&
    !commandProofPayloadExplicitlyFailed(payload)
  );
}

function commandProofSatisfied(id, result) {
  const payloads = commandProofPayloads(result);
  if (payloads.length === 0) return { ok: false, reasonCode: 'missing_structured_proof' };
  if (!payloads.some(commandProofPayloadSucceeded)) return { ok: false, reasonCode: 'missing_structured_success' };
  const auditedSuccessPayloads = payloads.filter(commandProofPayloadAuditedSuccess);
  if (auditedSuccessPayloads.length === 0) return { ok: false, reasonCode: 'missing_audit_proof' };
  if (id === 'kill_switch' && !auditedSuccessPayloads.some(commandProofPayloadFailsClosed)) {
    return { ok: false, reasonCode: 'kill_switch_not_fail_closed' };
  }
  return { ok: true };
}

function runConfiguredCommandGate(id, envName, env = process.env, options = {}) {
  const command = env[envName];
  if (!command || !String(command).trim()) {
    return blockedGate(id, 'runtime_not_configured', `${envName} is required for ${id} proof.`, {
      command: `${envName}=<command>`,
    });
  }

  const normalizedCommand = String(command).trim();
  if (FORBIDDEN_PROOF_COMMAND_PATTERN.test(normalizedCommand)) {
    return failedGate(id, 'unapproved_executor', `${id} proof command uses an unapproved local executor.`, {
      command: normalizedCommand,
    });
  }
  const parsedCommand = parseProofCommand(normalizedCommand);
  if (!parsedCommand.ok) {
    return failedGate(id, parsedCommand.reasonCode, `${id} proof command uses unsupported shell syntax.`, {
      command: normalizedCommand,
    });
  }
  if (!approvedProofExecutable(parsedCommand.executableName)) {
    return failedGate(
      id,
      'unapproved_proof_command',
      `${id} proof command must invoke brokered OpenClaw/Hermes/Mac-control tooling.`,
      { command: normalizedCommand }
    );
  }

  const result = runProofCommand(parsedCommand, options);
  if (result.status === 0 && !result.signal && !result.error) {
    const proof = commandProofSatisfied(id, result);
    if (!proof.ok) {
      return failedGate(id, proof.reasonCode, `${id} command did not emit required audited structured proof.`, {
        command: normalizedCommand,
        data: summarizeProofCommandResult(result),
      });
    }
    return passedGate(id, `${id} command completed.`, {
      command: normalizedCommand,
      data: summarizeProofCommandResult(result),
    });
  }

  return failedGate(id, 'runtime_not_configured', `${id} command failed.`, {
    command: normalizedCommand,
    data: summarizeProofCommandResult(result),
  });
}

function readComputerUseEvidence(evidencePath) {
  if (!evidencePath || !String(evidencePath).trim()) {
    return null;
  }
  const resolvedPath = path.resolve(String(evidencePath));
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Computer Use evidence file not found: ${resolvedPath}`);
  }
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`Computer Use evidence path must be a file: ${resolvedPath}`);
  }
  if (stat.size > 2 * 1024 * 1024) {
    throw new Error(`Computer Use evidence file is too large for a redacted proof packet: ${resolvedPath}`);
  }
  return {
    path: resolvedPath,
    text: sanitizeText(fs.readFileSync(resolvedPath, 'utf8')),
  };
}

function runComputerUseEvidenceGate(options) {
  const evidencePath = options.computerUseEvidencePath || process.env.EVAOS_MAC_CONTROL_DOCTOR_COMPUTER_USE_EVIDENCE;
  if (!evidencePath || !String(evidencePath).trim()) {
    return blockedGate(
      'computer_use_evidence',
      'runtime_not_configured',
      'Exact-path Computer Use screenshot/accessibility evidence is required for #437 release proof.'
    );
  }

  let evidence;
  try {
    evidence = readComputerUseEvidence(evidencePath);
  } catch (error) {
    return failedGate('computer_use_evidence', 'runtime_not_configured', 'Computer Use evidence could not be read.', {
      data: { message: error?.message || String(error) },
    });
  }

  const requiredMarkers = [
    installedProof.DEFAULT_APP_PATH,
    options.supportAccount || DEFAULT_SUPPORT_ACCOUNT,
    options.supportTarget || DEFAULT_SUPPORT_TARGET,
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !evidence.text.includes(marker));
  const requiredConcepts = [
    { name: 'screenshot', pattern: /screenshot|png|image/i },
    { name: 'accessibility', pattern: /accessibility|ax|accessibility tree/i },
    { name: 'visible-agent-tool-proof', pattern: /visible agent|mac tool proof|visible-agent-mac-tools|tool proof/i },
    { name: 'mac-control', pattern: /mac (?:& iphone|control)|native companion/i },
  ];
  const missingConcepts = requiredConcepts
    .filter((entry) => !entry.pattern.test(evidence.text))
    .map((entry) => entry.name);

  if (missingMarkers.length > 0 || missingConcepts.length > 0) {
    return failedGate(
      'computer_use_evidence',
      'runtime_not_configured',
      'Computer Use evidence is present but incomplete.',
      {
        evidencePath: evidence.path,
        data: {
          missingMarkers,
          missingConcepts,
        },
      }
    );
  }

  return passedGate('computer_use_evidence', 'Computer Use exact-path product evidence is present.', {
    evidencePath: evidence.path,
  });
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isBridgeReadyPayload(payload) {
  return (
    payload &&
    typeof payload === 'object' &&
    payload.schema === 'evaos.desktop_bridge.ready.v1' &&
    payload.ok === true &&
    payload.ready === true
  );
}

function nestedValue(payload, keys, depth = 0) {
  if (!payload || depth > 6) return undefined;
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const value = nestedValue(entry, keys, depth + 1);
      if (value !== undefined) return value;
    }
    return undefined;
  }
  if (typeof payload !== 'object') return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      return payload[key];
    }
  }
  for (const value of Object.values(payload)) {
    const nested = nestedValue(value, keys, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function collectPayloadCodes(payload, codes = [], depth = 0) {
  if (!payload || depth > 6) return codes;
  if (Array.isArray(payload)) {
    for (const entry of payload) collectPayloadCodes(entry, codes, depth + 1);
    return codes;
  }
  if (typeof payload !== 'object') return codes;

  for (const key of ['code', 'error', 'reasonCode', 'reason_code', 'status', 'state']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) codes.push(value.trim());
  }
  for (const value of Object.values(payload)) {
    collectPayloadCodes(value, codes, depth + 1);
  }
  return codes;
}

function normalizeBridgeReadyReasonCode(code) {
  const normalized = String(code || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) return undefined;
  if (/kill_switch|control_kill_switch_active/.test(normalized)) return 'control_kill_switch_active';
  if (/connector_service_unreachable|service_unreachable|connection_refused|unreachable|offline/.test(normalized)) {
    return 'connector_service_unreachable';
  }
  if (/connector_service_not_running|not_running|not_loaded|launchagent_not_loaded/.test(normalized)) {
    return 'connector_service_not_running';
  }
  if (/missing_live_listener|not_listening|listener_missing|listener_not_running/.test(normalized)) {
    return 'missing_live_listener';
  }
  if (/stale_bridge_owner|stale_owner|wrong_owner|not_workbench_managed/.test(normalized)) {
    return 'stale_bridge_owner';
  }
  if (/token_missing/.test(normalized)) return 'token_missing';
  return undefined;
}

function bridgeReadyPayloadReasonCode(payload) {
  if (!payload || typeof payload !== 'object') return 'bridge_diagnostics_unavailable';
  if (nestedValue(payload, ['kill_switch', 'killSwitch']) === true) return 'control_kill_switch_active';
  const normalized = collectPayloadCodes(payload).map(normalizeBridgeReadyReasonCode).find(Boolean);
  if (normalized) return normalized;
  if (nestedValue(payload, ['running']) === false) return 'connector_service_not_running';
  if (nestedValue(payload, ['reachable']) === false) return 'connector_service_unreachable';
  return 'bridge_diagnostics_unavailable';
}

function bridgeOwnerTruthBlocker(desktopProofState) {
  if (!desktopProofState || typeof desktopProofState !== 'object') return null;
  const listener = desktopProofState.bridgeListener || {};
  const staleOwners = Array.isArray(listener.staleOwners) ? listener.staleOwners : [];
  const listenerListening = listener.status === 'listening';
  if (desktopProofState.staleLaunchAgent || desktopProofState.staleBridgeListener || staleOwners.length > 0) {
    return {
      reasonCode: 'stale_bridge_owner',
      message: 'Bridge live owner truth does not match the installed Workbench candidate.',
    };
  }
  if (listener.status && listener.status !== 'listening') {
    return {
      reasonCode: 'missing_live_listener',
      message: 'No live Workbench bridge listener is present for Mac-control proof.',
    };
  }
  if (
    desktopProofState.launchAgent?.status &&
    desktopProofState.launchAgent.status !== 'loaded' &&
    !listenerListening
  ) {
    return {
      reasonCode: 'connector_service_not_running',
      message: 'Workbench bridge LaunchAgent is not loaded.',
    };
  }
  return null;
}

function summarizeBridgeReadyPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      parseable: false,
    };
  }

  const connectorService =
    payload.connector_service && typeof payload.connector_service === 'object' ? payload.connector_service : {};
  const health = connectorService.health && typeof connectorService.health === 'object' ? connectorService.health : {};
  const owner = connectorService.owner && typeof connectorService.owner === 'object' ? connectorService.owner : {};
  const controlSession =
    payload.control_session && typeof payload.control_session === 'object' ? payload.control_session : {};
  const serviceEvents = Array.isArray(payload.service_events) ? payload.service_events : [];

  return sanitizeValue({
    schema: payload.schema,
    ok: payload.ok,
    ready: payload.ready,
    service: payload.service,
    connectorService: {
      ok: connectorService.ok,
      ready: connectorService.ready,
      running: connectorService.running,
      loaded: connectorService.loaded,
      managedBy: connectorService.managed_by,
      health: {
        authenticated: health.authenticated,
        hostKind: health.host_kind,
        reachable: health.reachable,
        ready: health.ready,
      },
      owner: {
        classification: owner.classification,
        bundleId: owner.bundle_id,
        label: owner.label,
        appPathKind: owner.app_path?.kind,
        programPathKind: owner.program_path?.kind,
        plistPathKind: owner.plist_path?.kind,
        manifestPathKind: owner.manifest_path?.kind,
        sourceCommitPresent: Boolean(owner.source_commit),
      },
    },
    controlSession: {
      active: controlSession.active,
      mode: controlSession.mode,
      killSwitch: controlSession.kill_switch,
    },
    blockerCodes: Array.isArray(payload.blockers)
      ? payload.blockers
          .map((blocker) => blocker?.code)
          .filter(Boolean)
          .slice(0, 12)
      : [],
    serviceEventCategories: serviceEvents
      .map((event) => event?.category)
      .filter(Boolean)
      .slice(-8),
  });
}

function jsonCandidatesFromText(text) {
  const candidates = [];
  const trimmed = String(text || '').trim();
  if (!trimmed) return candidates;
  candidates.push(trimmed);

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    candidates.push(match[1].trim());
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') || line.startsWith('['));
  candidates.push(...lines);

  for (const opener of ['{', '[']) {
    const closer = opener === '{' ? '}' : ']';
    const start = trimmed.indexOf(opener);
    const end = trimmed.lastIndexOf(closer);
    if (start >= 0 && end > start) {
      candidates.push(trimmed.slice(start, end + 1));
    }
  }

  return Array.from(new Set(candidates));
}

function payloadsFromVisibleAgentEvidence(evidence) {
  if (evidence && typeof evidence === 'object') return [evidence];
  if (typeof evidence !== 'string') return [];
  return jsonCandidatesFromText(evidence).map(parseJsonMaybe).filter(Boolean);
}

function visibleAgentEvidenceText(text, options = {}) {
  let output = String(text || '');
  const beforeText = String(options.beforeText || '');
  const prompt = String(options.prompt || '');
  if (beforeText) {
    if (output.startsWith(beforeText)) output = output.slice(beforeText.length);
    else output = output.replace(beforeText, ' ');
  }
  if (prompt) {
    output = output.split(prompt).join(' ');
  }
  return output;
}

function collectVisibleAgentToolRecords(payload, records = [], depth = 0) {
  if (!payload || depth > 5) return records;
  if (Array.isArray(payload)) {
    for (const entry of payload) collectVisibleAgentToolRecords(entry, records, depth + 1);
    return records;
  }
  if (typeof payload !== 'object') return records;

  const record = payload;
  if (visibleAgentToolName(record)) {
    records.push(record);
  }

  for (const [key, value] of Object.entries(record)) {
    if (VISIBLE_AGENT_TOOL_ARRAY_KEYS.includes(key) && Array.isArray(value)) {
      for (const entry of value) collectVisibleAgentToolRecords(entry, records, depth + 1);
    } else if (value && typeof value === 'object') {
      collectVisibleAgentToolRecords(value, records, depth + 1);
    }
  }

  return records;
}

function visibleAgentToolName(record) {
  if (!record || typeof record !== 'object') return undefined;
  const direct =
    record.tool ||
    record.name ||
    record.id ||
    record.toolName ||
    record.tool_name ||
    record.function?.name ||
    record.call?.name;
  return typeof direct === 'string' && direct.trim() ? direct.trim() : undefined;
}

function visibleAgentRecordStatus(record) {
  if (!record || typeof record !== 'object') return undefined;
  if (record.ok === true || record.success === true || record.passed === true) return 'ok';
  const value = record.status || record.outcome || record.resultStatus || record.result_status;
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined;
}

function visibleAgentRecordSucceeded(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.ok === false || record.success === false || record.passed === false || record.error) return false;
  const status = visibleAgentRecordStatus(record);
  return status ? VISIBLE_AGENT_SUCCESS_STATUSES.has(status) : record.ok === true;
}

function visibleAgentRecordHasAuditId(record) {
  if (!record || typeof record !== 'object') return false;
  const direct =
    record.auditId ||
    record.audit_id ||
    record.auditEventId ||
    record.audit_event_id ||
    record.auditRecordId ||
    record.audit_record_id ||
    record.eventId ||
    record.event_id;
  if (typeof direct === 'string' && direct.trim()) return true;
  for (const key of ['result', 'data', 'output', 'structuredResult', 'structured_result']) {
    const value = record[key];
    if (!value || typeof value !== 'object') continue;
    const nested =
      value.auditId ||
      value.audit_id ||
      value.auditEventId ||
      value.audit_event_id ||
      value.auditRecordId ||
      value.audit_record_id ||
      value.eventId ||
      value.event_id;
    if (typeof nested === 'string' && nested.trim()) return true;
  }
  return false;
}

function visibleAgentRecordHasStructuredResult(record) {
  if (!record || typeof record !== 'object') return false;
  return Boolean(
    (record.result && typeof record.result === 'object') ||
    (record.data && typeof record.data === 'object') ||
    (record.output && typeof record.output === 'object') ||
    (record.structuredResult && typeof record.structuredResult === 'object') ||
    (record.structured_result && typeof record.structured_result === 'object')
  );
}

function visibleAgentRecordApproved(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.approved === true || record.approval === true || record.userApproved === true) return true;
  const approval = record.approval || record.approvalStatus || record.approval_status;
  return typeof approval === 'string' && /approved|allowed|granted/i.test(approval);
}

function visibleAgentRecordLowImpact(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.lowImpact === true || record.low_impact === true) return true;
  const haystack = [
    visibleAgentToolName(record),
    record.category,
    record.kind,
    record.action,
    record.actionName,
    record.action_name,
    record.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /low[-_\s]?impact|frontmost|active app|list windows|get[_\s-]?window|clipboard[_\s-]?read/.test(haystack);
}

function runVisibleAgentMacToolEvidenceGate(evidence) {
  const text = typeof evidence === 'string' ? evidence : JSON.stringify(evidence ?? '');
  if (OS_PERMISSION_PROMPT_PATTERN.test(text)) {
    return failedGate(
      'visible_agent_mac_tools',
      'permission_missing',
      'Visible Workbench agent proof triggered an OS permission prompt for node/osascript/System Events.',
      { data: { failureKind: 'fatal' } }
    );
  }
  if (VISIBLE_AGENT_FAILURE_PATTERN.test(text)) {
    return failedGate(
      'visible_agent_mac_tools',
      'agent_cli_config_invalid',
      'Visible Workbench agent proof rendered an ACP/startup/broker-boundary failure.',
      { data: { failureKind: 'fatal' } }
    );
  }

  const records = payloadsFromVisibleAgentEvidence(evidence).flatMap((payload) =>
    collectVisibleAgentToolRecords(payload)
  );
  if (records.length === 0) {
    return failedGate(
      'visible_agent_mac_tools',
      'agent_cli_config_invalid',
      'Visible Workbench agent proof must include structured Mac-control tool results.',
      { data: { failureKind: 'incomplete', missingTools: REQUIRED_VISIBLE_AGENT_MAC_TOOLS } }
    );
  }

  const successfulStructuredRecords = records.filter(
    (record) => visibleAgentRecordSucceeded(record) && visibleAgentRecordHasStructuredResult(record)
  );
  const successfulRecords = successfulStructuredRecords.filter(visibleAgentRecordHasAuditId);
  const observedTools = Array.from(new Set(successfulRecords.map(visibleAgentToolName).filter(Boolean)));
  const missingTools = REQUIRED_VISIBLE_AGENT_MAC_TOOLS.filter((tool) => !observedTools.includes(tool));
  const lowImpactRecord = successfulRecords.find(
    (record) => visibleAgentRecordLowImpact(record) && visibleAgentRecordApproved(record)
  );
  const killSwitchRecords = successfulRecords.filter(
    (record) => visibleAgentToolName(record) === 'desktop_kill_switch'
  );
  const missingAuditTools = Array.from(
    new Set(
      successfulStructuredRecords
        .filter((record) => !visibleAgentRecordHasAuditId(record))
        .map(visibleAgentToolName)
        .filter(Boolean)
    )
  );

  if (missingTools.length > 0 || !lowImpactRecord) {
    return failedGate(
      'visible_agent_mac_tools',
      'agent_cli_config_invalid',
      missingAuditTools.length > 0
        ? 'Visible Workbench agent proof is missing audit ids for required Mac-control tool results.'
        : 'Visible Workbench agent proof is missing required structured Mac-control tool results.',
      {
        data: {
          failureKind: 'incomplete',
          observedTools,
          missingTools,
          missingLowImpactAction: !lowImpactRecord,
          missingAuditTools,
        },
      }
    );
  }

  if (!killSwitchRecords.some(commandProofPayloadFailsClosed)) {
    return failedGate(
      'visible_agent_mac_tools',
      'kill_switch_not_fail_closed',
      'Visible Workbench agent proof must show desktop_kill_switch failed closed.',
      {
        data: {
          failureKind: 'incomplete',
          observedTools,
        },
      }
    );
  }

  return passedGate('visible_agent_mac_tools', 'Visible Workbench agent returned structured Mac-control tool proof.', {
    data: {
      observedTools,
      lowImpactAction: visibleAgentToolName(lowImpactRecord),
    },
  });
}

function runBridgeReadyGate(appPath, options = {}) {
  const bridgePath = bridgePathForApp(appPath);
  if (!fs.existsSync(bridgePath)) {
    return blockedGate('bridge_ready', 'bridge_cli_missing', `Bundled bridge is missing at ${bridgePath}.`);
  }

  const result = spawnSync(bridgePath, ['ready', '--json'], {
    encoding: 'utf8',
    timeout: options.timeout || DEFAULT_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  const stdout = sanitizeText(result.stdout || '');
  const stderr = sanitizeText(result.stderr || '');
  const parsed = parseJsonMaybe(result.stdout || '');
  const ok = result.status === 0 && !result.signal && isBridgeReadyPayload(parsed);
  const ownerBlocker = bridgeOwnerTruthBlocker(options.desktopProofState);
  const commandSummary = {
    status: result.status,
    signal: result.signal || undefined,
    stdoutDigest: stdout ? textDigest(stdout) : undefined,
    stderrDigest: stderr ? textDigest(stderr) : undefined,
    stdoutBytes: stdout ? Buffer.byteLength(stdout, 'utf8') : 0,
    stderrBytes: stderr ? Buffer.byteLength(stderr, 'utf8') : 0,
  };

  if (ownerBlocker) {
    return failedGate('bridge_ready', ownerBlocker.reasonCode, ownerBlocker.message, {
      command: `${bridgePath} ready --json`,
      data: {
        ...commandSummary,
        ready: summarizeBridgeReadyPayload(parsed),
        desktopProofState: sanitizeValue(options.desktopProofState),
      },
    });
  }

  if (ok) {
    return passedGate('bridge_ready', 'Bundled bridge /ready check passed.', {
      command: `${bridgePath} ready --json`,
      data: { ...commandSummary, ready: summarizeBridgeReadyPayload(parsed) },
    });
  }

  const reasonCode = bridgeReadyPayloadReasonCode(parsed);

  return failedGate('bridge_ready', reasonCode, 'Bundled bridge /ready check failed.', {
    command: `${bridgePath} ready --json`,
    data: {
      status: result.status,
      signal: result.signal,
      ...commandSummary,
      error: result.error ? sanitizeText(result.error.message) : undefined,
      readySchema: parsed && typeof parsed === 'object' ? parsed.schema : undefined,
      readyOk: parsed && typeof parsed === 'object' ? parsed.ok : undefined,
      readyState: parsed && typeof parsed === 'object' ? parsed.ready : undefined,
      ready: summarizeBridgeReadyPayload(parsed),
    },
  });
}

function readinessGatePassed(gates) {
  return gateStatus(gates, 'mac_control_cold_start') === 'passed' && gateStatus(gates, 'bridge_ready') === 'passed';
}

function macControlReadyTextSatisfied(text) {
  const normalized = String(text || '');
  if (
    /repair_required|Repair needed|Setup needed|Needs retry|Needs permission|Reconnect Workbench|needs Mac pairing|Create Pairing Prompt|Mac access needs repair/i.test(
      normalized
    )
  ) {
    return false;
  }
  const connectedOrAlreadyPaired =
    /Mac control is connected for this evaOS Workbench session/i.test(normalized) ||
    /Mac control is ready/i.test(normalized) ||
    /Full Access agent control is active/i.test(normalized);
  return (
    connectedOrAlreadyPaired &&
    /Workbench connector is reporting\s+ready locally/i.test(normalized) &&
    /Accessibility and Screen Recording are ready/i.test(normalized) &&
    /Guided Mac control setup[\s\S]*Ready/i.test(normalized)
  );
}

function promptConversationMarker(prompt) {
  return (
    String(prompt || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length >= 12) || String(prompt || '').slice(0, 80)
  );
}

async function resolveMainWindow(electronApp) {
  const existing = electronApp.windows().find((page) => !page.url().startsWith('devtools://'));
  if (existing) {
    await existing.waitForLoadState('domcontentloaded');
    return existing;
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const page = await electronApp.waitForEvent('window', { timeout: 1_000 }).catch(() => null);
    if (page && !page.url().startsWith('devtools://')) {
      await page.waitForLoadState('domcontentloaded');
      return page;
    }
  }

  throw new Error('Failed to resolve installed app renderer window.');
}

async function captureUiFailure(page, artifactRoot, gateId, error) {
  const screenshotName = `screenshots/${gateId}-failure.png`;
  const screenshotPath = path.join(artifactRoot, 'artifacts', screenshotName);
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page?.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  return {
    screenshot: screenshotName,
    message: sanitizeText(error?.message || String(error)),
  };
}

async function waitForBodyText(page, marker, timeout) {
  await page
    .locator(`body:has-text(${JSON.stringify(marker)})`)
    .first()
    .waitFor({ state: 'visible', timeout });
}

async function waitForBodyMarkers(page, markers, timeout) {
  await page.waitForFunction(
    (expectedMarkers) => {
      const text = document.body?.innerText || '';
      return expectedMarkers.every((marker) => text.includes(marker));
    },
    markers,
    { timeout }
  );
}

async function collectAgentPillState(page) {
  return page
    .evaluate(() =>
      Array.from(document.querySelectorAll('[data-agent-pill="true"]')).map((pill) => ({
        key: pill.getAttribute('data-agent-key'),
        type: pill.getAttribute('data-agent-type'),
        selected: pill.getAttribute('data-agent-selected'),
        nativeStatus: pill.getAttribute('data-agent-native-status'),
        text: pill.textContent?.trim().slice(0, 120) || '',
      }))
    )
    .catch((error) => [{ stateError: sanitizeText(error?.message || String(error)) }]);
}

async function navigateHash(page, route, timeout) {
  const expectedHash = route.startsWith('#') ? route : `#${route}`;
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, expectedHash);
  await page.waitForFunction((hash) => window.location.hash === hash, expectedHash, { timeout });
  await page.waitForLoadState('domcontentloaded');
}

function cssAttributeValue(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

async function maybeSelectProofAgent(page, options = {}) {
  const agentKey = options.agentKey;
  const agentType = options.agentType;
  const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
  await page.locator('[data-agent-pill="true"]').first().waitFor({ state: 'visible', timeout });

  let selector = null;
  if (agentKey) {
    selector = `[data-agent-pill="true"][data-agent-key="${cssAttributeValue(agentKey)}"]`;
  } else if (agentType) {
    selector = `[data-agent-pill="true"][data-agent-type="${cssAttributeValue(agentType)}"]`;
  } else {
    for (const candidate of DEFAULT_PROOF_AGENT_SELECTORS) {
      if (
        await page
          .locator(candidate)
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        selector = candidate;
        break;
      }
    }
  }

  if (!selector) {
    const agents = await collectAgentPillState(page);
    throw new Error(`No evaOS/OpenClaw proof agent pill is visible. Available agents: ${JSON.stringify(agents)}`);
  }

  const pill = page.locator(selector).first();
  await pill.waitFor({ state: 'visible', timeout: options.timeout || DEFAULT_TIMEOUT_MS });
  const selected = await pill.getAttribute('data-agent-selected').catch(() => null);
  if (selected !== 'true') {
    await pill.click();
    await page.waitForFunction(
      (agentSelector) => document.querySelector(agentSelector)?.getAttribute('data-agent-selected') === 'true',
      selector,
      { timeout: options.timeout || DEFAULT_TIMEOUT_MS }
    );
  }
  const selectedState = await pill.evaluate((node) => ({
    key: node.getAttribute('data-agent-key'),
    type: node.getAttribute('data-agent-type'),
    nativeStatus: node.getAttribute('data-agent-native-status'),
    text: node.textContent?.trim().slice(0, 120) || '',
  }));
  if (!/^(openclaw|openclaw-gateway)$/.test(selectedState.key || selectedState.type || '')) {
    throw new Error(`Selected proof agent is not evaOS/OpenClaw: ${JSON.stringify(selectedState)}`);
  }
  return sanitizeValue(selectedState);
}

async function captureVisibleAgentFailureState(page, artifactRoot, gateId, error) {
  const failure = await captureUiFailure(page, artifactRoot, gateId, error);
  const state = await page
    .evaluate(() => {
      const input = document.querySelector('[data-testid="guid-input"] textarea, textarea[data-testid="guid-input"]');
      const sendButton = document.querySelector('[data-testid="guid-send-btn"]');
      const selectedAgent = document.querySelector('[data-agent-pill="true"][data-agent-selected="true"]');
      const bodyText = document.body?.innerText || '';
      const inputValue = input instanceof HTMLTextAreaElement ? input.value : '';
      return {
        hash: window.location.hash,
        inputSummary: inputValue
          ? {
              length: inputValue.length,
              sha256Prefix: '__INPUT_DIGEST__',
            }
          : null,
        sendDisabled:
          sendButton instanceof HTMLButtonElement
            ? sendButton.disabled
            : sendButton?.getAttribute('aria-disabled') || sendButton?.getAttribute('disabled') || null,
        selectedAgent: selectedAgent
          ? {
              key: selectedAgent.getAttribute('data-agent-key'),
              type: selectedAgent.getAttribute('data-agent-type'),
              nativeStatus: selectedAgent.getAttribute('data-agent-native-status'),
              text: selectedAgent.textContent?.trim().slice(0, 120),
            }
          : null,
        availableAgents: Array.from(document.querySelectorAll('[data-agent-pill="true"]')).map((pill) => ({
          key: pill.getAttribute('data-agent-key'),
          type: pill.getAttribute('data-agent-type'),
          selected: pill.getAttribute('data-agent-selected'),
          nativeStatus: pill.getAttribute('data-agent-native-status'),
          text: pill.textContent?.trim().slice(0, 120) || '',
        })),
        bodySummary: {
          length: bodyText.length,
          sha256Prefix: '__BODY_DIGEST__',
        },
      };
    })
    .catch((stateError) => ({ stateError: sanitizeText(stateError?.message || String(stateError)) }));
  if (state && typeof state === 'object') {
    if (error?.preSendAgentState) state.preSendAgentState = sanitizeValue(error.preSendAgentState);
    if (error?.structuredFailureEvidence) {
      state.structuredFailureEvidence = sanitizeValue(error.structuredFailureEvidence);
    }
  }
  if (
    state &&
    typeof state === 'object' &&
    state.inputSummary &&
    state.inputSummary.sha256Prefix === '__INPUT_DIGEST__'
  ) {
    const inputValue = await page
      .evaluate(() => {
        const input = document.querySelector('[data-testid="guid-input"] textarea, textarea[data-testid="guid-input"]');
        return input instanceof HTMLTextAreaElement ? input.value : '';
      })
      .catch(() => '');
    state.inputSummary.sha256Prefix = textDigest(inputValue);
  }
  if (state && typeof state === 'object' && state.bodySummary && state.bodySummary.sha256Prefix === '__BODY_DIGEST__') {
    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    state.bodySummary.sha256Prefix = textDigest(bodyText);
  }
  return { ...failure, state: sanitizeValue(state) };
}

async function setTextareaValue(page, selector, value, timeout) {
  const input = page.locator(selector).first();
  await input.waitFor({ state: 'visible', timeout });
  await input.fill(value).catch(async () => {
    await input.click();
    await page.evaluate(
      ({ inputSelector, nextValue }) => {
        const textarea = document.querySelector(inputSelector);
        if (!(textarea instanceof HTMLTextAreaElement)) {
          throw new Error(`Textarea not found for selector ${inputSelector}`);
        }
        const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        valueSetter?.call(textarea, nextValue);
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nextValue }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { inputSelector: selector, nextValue: value }
    );
  });
  await page.waitForFunction(
    ({ inputSelector, expectedValue }) => {
      const textarea = document.querySelector(inputSelector);
      return textarea instanceof HTMLTextAreaElement && textarea.value === expectedValue;
    },
    { inputSelector: selector, expectedValue: value },
    { timeout }
  );
}

async function clickNativeCompanionAction(page, timeout) {
  const candidateSelectors = [
    '[data-testid="native-companion-next-action"]',
    'button:has-text("Connect Mac Control")',
    'button:has-text("Turn On Mac Access")',
    'button:has-text("Run Setup Check")',
  ];

  for (const selector of candidateSelectors) {
    const count = await page
      .locator(selector)
      .count()
      .catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const button = page.locator(selector).nth(index);
      if (!(await button.isVisible().catch(() => false))) continue;
      const label = (await button.textContent().catch(() => '')) || selector;
      if (!/Turn On Mac Access|Connect Mac Control|Run Setup Check/i.test(label)) continue;
      const disabled = await button.evaluate((node) => {
        if (node instanceof HTMLButtonElement) return node.disabled;
        return node.getAttribute('aria-disabled') === 'true' || node.hasAttribute('disabled');
      });
      if (disabled) continue;
      await button.click({ timeout });
      return label.trim();
    }
  }

  return null;
}

async function convergeMacControlReady(page, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
  const proofTimeout = options.proofTimeout || Math.max(timeout, DEFAULT_AGENT_PROOF_TIMEOUT_MS);
  const deadline = Date.now() + Math.max(timeout, Math.min(proofTimeout, 120_000));
  const actionLog = [];
  let lastText = '';

  await waitForBodyText(page, 'Mac control', timeout);

  while (Date.now() < deadline) {
    lastText = await page.evaluate(() => document.body?.innerText || '');
    if (macControlReadyTextSatisfied(lastText)) {
      return { actionLog, text: lastText };
    }

    const action = await clickNativeCompanionAction(page, timeout).catch((error) => {
      actionLog.push(`click-error:${sanitizeText(error?.message || String(error)).slice(0, 160)}`);
      return null;
    });
    if (action) {
      actionLog.push(action);
      await page.waitForTimeout(1_750);
      continue;
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error(
    `Mac control did not converge to connected state. Actions: ${actionLog.join(' -> ') || 'none'}. Final text: ${sanitizeText(lastText).slice(0, 800)}`
  );
}

async function sendVisibleAgentMacToolProbe(page, timeout, prompt, options = {}) {
  const submitTimeout = options.submitTimeout || timeout;
  const proofTimeout = options.proofTimeout || Math.max(timeout, DEFAULT_AGENT_PROOF_TIMEOUT_MS);
  let preSendAgentState = null;

  try {
    const selectedAgent = await maybeSelectProofAgent(page, {
      agentKey: options.agentKey,
      agentType: options.agentType,
      timeout: submitTimeout,
    });
    preSendAgentState = {
      selectedAgent,
      availableAgents: await collectAgentPillState(page),
    };

    const inputSelector = '[data-testid="guid-input"] textarea, textarea[data-testid="guid-input"]';
    await setTextareaValue(page, inputSelector, prompt, submitTimeout);
    const beforeSendText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');

    const sendButton = page.locator('[data-testid="guid-send-btn"]').first();
    await sendButton.waitFor({ state: 'visible', timeout: submitTimeout });
    await page.waitForFunction(
      () => {
        const button = document.querySelector('[data-testid="guid-send-btn"]');
        if (!button) return false;
        if (button instanceof HTMLButtonElement) return !button.disabled;
        return button.getAttribute('aria-disabled') !== 'true' && !button.hasAttribute('disabled');
      },
      undefined,
      { timeout: submitTimeout }
    );
    await sendButton.click();

    await page.waitForFunction(() => /^#\/conversation\/[^/]+/.test(window.location.hash), undefined, {
      timeout: submitTimeout,
    });
    await waitForBodyMarkers(page, [promptConversationMarker(prompt)], submitTimeout);
    const deadline = Date.now() + proofTimeout;
    let lastGate = runVisibleAgentMacToolEvidenceGate('');
    while (Date.now() < deadline) {
      const text = await page.evaluate(() => document.body?.innerText || '');
      lastGate = runVisibleAgentMacToolEvidenceGate(
        visibleAgentEvidenceText(text, { beforeText: beforeSendText, prompt })
      );
      if (lastGate.status === 'passed') return lastGate;
      if (lastGate.data?.failureKind === 'fatal') {
        const error = new Error(lastGate.message || 'Visible agent Mac-tool proof failed.');
        error.preSendAgentState = preSendAgentState;
        error.structuredFailureEvidence = lastGate;
        throw error;
      }
      await page.waitForTimeout(500);
    }
    const error = new Error(lastGate.message || 'Visible agent Mac-tool proof did not settle.');
    error.preSendAgentState = preSendAgentState;
    error.structuredFailureEvidence = lastGate;
    throw error;
  } catch (error) {
    if (preSendAgentState && error && typeof error === 'object' && !error.preSendAgentState) {
      error.preSendAgentState = preSendAgentState;
    }
    throw error;
  }
}

async function ensureAdminRouteSurfaceVisible(page, timeout) {
  const adminToggle = page.locator('[data-testid="evaos-sidebar-admin-toggle"]').first();
  if (adminToggle.waitFor) {
    await adminToggle.waitFor({ state: 'visible', timeout }).catch(() => undefined);
  }
  if (!(await adminToggle.isVisible().catch(() => false))) return;
  const expanded = await adminToggle.getAttribute('aria-expanded').catch(() => null);
  if (expanded === 'true') return;
  await adminToggle.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="evaos-sidebar-admin-toggle"]')?.getAttribute('aria-expanded') === 'true',
    undefined,
    { timeout }
  );
}

async function runUiProductGates(options) {
  const appPath = options.appPath || installedProof.DEFAULT_APP_PATH;
  const executablePath = installedProof.installedExecutablePath(appPath);
  const artifactRoot = options.artifactRoot;
  const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
  const proofTimeout = options.proofTimeout || DEFAULT_AGENT_PROOF_TIMEOUT_MS;
  const supportAccount = options.supportAccount || DEFAULT_SUPPORT_ACCOUNT;
  const supportTarget = options.supportTarget || DEFAULT_SUPPORT_TARGET;
  const chatPrompt = options.chatPrompt || VISIBLE_AGENT_MAC_TOOL_PROMPT;
  const gates = [];

  const { _electron: electron } = require('playwright');
  let electronApp;
  let page;
  try {
    electronApp = await electron.launch({
      executablePath,
      cwd: path.dirname(executablePath),
      env: {
        ...process.env,
        AIONUI_DISABLE_AUTO_UPDATE: '1',
        AIONUI_DISABLE_DEVTOOLS: '1',
        AIONUI_CDP_PORT: '0',
        AIONUI_MULTI_INSTANCE: '1',
        EVAOS_MAC_CONTROL_DOCTOR: '1',
        NODE_ENV: 'production',
      },
      timeout: 60_000,
    });
    page = await resolveMainWindow(electronApp);
    await page.setViewportSize({ width: 1440, height: 1000 });

    try {
      await waitForBodyText(page, supportAccount, timeout);
      await waitForBodyText(page, supportTarget, timeout);
      gates.push(
        passedGate('support_account_target', 'Signed app shows the expected support account and target.', {
          data: { account: supportAccount, target: supportTarget },
        })
      );
    } catch (error) {
      gates.push(
        failedGate('support_account_target', 'runtime_not_configured', 'Support account/target did not settle.', {
          data: await captureUiFailure(page, artifactRoot, 'support_account_target', error),
        })
      );
    }

    try {
      await ensureAdminRouteSurfaceVisible(page, timeout);
      for (const marker of ROUTE_MARKERS) {
        await waitForBodyText(page, marker, timeout);
      }
      gates.push(
        passedGate('route_visibility', 'All expected support/admin routes are visible.', {
          data: { markers: ROUTE_MARKERS },
        })
      );
    } catch (error) {
      gates.push(
        failedGate('route_visibility', 'runtime_not_configured', 'Expected route visibility did not settle.', {
          data: await captureUiFailure(page, artifactRoot, 'route_visibility', error),
        })
      );
    }

    try {
      await navigateHash(page, '/native-companion', timeout);
      const convergence = await convergeMacControlReady(page, { timeout, proofTimeout });
      const screenshot = 'screenshots/mac-control-cold-start.png';
      await page.screenshot({ path: path.join(artifactRoot, 'artifacts', screenshot), fullPage: true });
      if (!macControlReadyTextSatisfied(convergence.text)) {
        throw new Error('Mac control cold-start reached a non-ready or ambiguous state.');
      }
      gates.push(
        passedGate('mac_control_cold_start', 'Mac & iPhone cold-start reached no-code ready state.', {
          evidencePath: `artifacts/${screenshot}`,
          data: { actionLog: convergence.actionLog },
        })
      );
    } catch (error) {
      gates.push(
        failedGate('mac_control_cold_start', 'connector_service_not_ready', 'Mac control cold-start proof failed.', {
          data: await captureUiFailure(page, artifactRoot, 'mac_control_cold_start', error),
        })
      );
    }

    try {
      await navigateHash(page, '/home', timeout);
      const toolGate = await sendVisibleAgentMacToolProbe(page, timeout, chatPrompt, {
        proofTimeout,
        agentKey: options.agentKey,
        agentType: options.agentType,
      });
      const screenshot = 'screenshots/visible-agent-mac-tools.png';
      await page.screenshot({ path: path.join(artifactRoot, 'artifacts', screenshot), fullPage: true });
      gates.push(
        passedGate('visible_agent_mac_tools', 'Visible Workbench agent returned structured Mac-control tool proof.', {
          evidencePath: `artifacts/${screenshot}`,
          data: toolGate.data,
        })
      );
    } catch (error) {
      const failureData = await captureVisibleAgentFailureState(page, artifactRoot, 'visible_agent_mac_tools', error);
      const structuredReason =
        error?.structuredFailureEvidence && typeof error.structuredFailureEvidence === 'object'
          ? error.structuredFailureEvidence.reasonCode
          : undefined;
      gates.push(
        failedGate(
          'visible_agent_mac_tools',
          structuredReason || 'runtime_not_configured',
          'Visible Workbench agent Mac-tool proof failed.',
          {
            data: failureData,
          }
        )
      );
    }
  } finally {
    await electronApp?.close().catch(() => undefined);
  }

  return gates;
}

function buildDiagnosticPacket(options, gates, extras = {}) {
  const failedOrBlocked = primaryDiagnosticBlocker(gates);
  const blockerCategory = failedOrBlocked?.reasonCode || 'unknown';
  const launchAgent = extras.desktopProofState?.launchAgent || {};
  const bundleInfo = extras.bundleInfo || {};
  const ready = readinessGatePassed(gates);
  const agentProofStatus = gateStatus(gates, 'visible_agent_mac_tools');
  const agentProofReady = ready && agentProofStatus === 'passed';
  const connectorReady = agentProofReady;

  return sanitizeValue({
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    app: {
      product: 'evaOS Workbench',
      bundleId: bundleInfo.bundleId || installedProof.DEFAULT_BUNDLE_ID,
      protocol: installedProof.DEFAULT_PROTOCOL_SCHEME,
      version: bundleInfo.shortVersion,
      sourceSha: options.expectedHead,
      channel: 'Mac release',
      installedPath: options.appPath,
      running: true,
    },
    signing: extras.signing || {
      summary: 'collected_by_installed_app_product_proof',
    },
    selectedContext: {
      accountEmail: options.supportAccount,
      customerId: options.customerId,
      customerLabel: options.customerLabel,
      vmTarget: options.supportTarget,
      route: '/native-companion',
    },
    runtimeStatus: {
      evaos: gateStatus(gates, 'visible_agent_mac_tools'),
      openclaw: gateStatus(gates, 'local_openclaw'),
      hermes: gateStatus(gates, 'hermes'),
      localAcp: gateStatus(gates, 'visible_agent_mac_tools'),
      lastStartupCategory: blockerCategory,
    },
    brokerGrant: {
      state: agentProofStatus,
      agentPairingStatus: agentProofReady ? 'agent_paired' : 'not_ready',
      sourcePointer: 'mac-control-doctor',
      auditIds: [],
    },
    bridge: {
      installed: Boolean(extras.bridgePath && fs.existsSync(extras.bridgePath)),
      status: gateStatus(gates, 'bridge_ready') === 'passed' ? 'ready' : 'repair_required',
      path: extras.bridgePath,
      diagnosticsStatus: 'unavailable',
      readyStatus: gateStatus(gates, 'bridge_ready') === 'passed' ? 'ready' : 'not_ready',
      readySource: 'mac-control-doctor',
    },
    connector: {
      status: connectorReady ? 'ready' : 'repair_required',
      ownerClassification: connectorReady ? 'workbench_managed' : blockerCategory,
      endpointSummary: 'redacted',
    },
    launchAgent: {
      label: launchAgent.label,
      state: launchAgent.status,
      programPathSummary: launchAgent.bridgePath,
      stalePath: extras.desktopProofState?.staleLaunchAgent,
    },
    tcc: {
      accessibility: 'collected_by_bridge_ready',
      screenRecording: 'collected_by_bridge_ready',
      holder: 'evaOS Workbench',
    },
    audit: {
      status: 'unavailable',
      auditIds: [],
    },
    lastAction: failedOrBlocked
      ? {
          action: failedOrBlocked.id,
          status: failedOrBlocked.status,
          message: failedOrBlocked.message,
          blockerReason: blockerCategory,
        }
      : undefined,
    blockerCategory,
    redaction: {
      rawSecretsStoredInWorkbench: false,
      urlsIpsPortsRedacted: true,
      rawPromptMaterialIncluded: false,
    },
  });
}

function primaryDiagnosticBlocker(gates) {
  const candidates = gates.filter((gate) => gate.status === 'failed' || gate.status === 'blocked');
  const bridgeTruth = candidates.find(
    (gate) => gate.id === 'bridge_ready' && BRIDGE_TRUTH_REASON_CODES.has(gate.reasonCode)
  );
  if (bridgeTruth) return bridgeTruth;
  const routeHarnessFailure = candidates.find(
    (gate) => gate.id === 'route_visibility' && gate.reasonCode === 'runtime_not_configured'
  );
  const coldStartFailure = candidates.find((gate) => gate.id === 'mac_control_cold_start');
  if (routeHarnessFailure && coldStartFailure) return coldStartFailure;
  return candidates[0];
}

function gateStatus(gates, id) {
  return gates.find((gate) => gate.id === id)?.status || 'pending';
}

function overallStatus(gates) {
  if (gates.some((gate) => gate.status === 'failed')) return 'failed';
  if (gates.some((gate) => gate.status === 'blocked')) return 'blocked';
  if (gates.some((gate) => gate.status === 'pending')) return 'pending';
  return 'passed';
}

function renderMarkdown(report) {
  const lines = [
    '# Mac Control Doctor Proof',
    '',
    `Schema: \`${REPORT_SCHEMA}\``,
    `Overall: \`${report.overallStatus}\``,
    `Expected commit: \`${shortHead(report.expectedHead)}\``,
    `App path: \`${report.appPath}\``,
    `Support account: \`${report.support.account}\``,
    `Support target: \`${report.support.target}\``,
    '',
    '## Gates',
    '',
  ];

  for (const gate of report.gates) {
    lines.push(`- \`${gate.id}\`: \`${gate.status}\`${gate.reasonCode ? ` (${gate.reasonCode})` : ''}`);
    if (gate.message) lines.push(`  - ${gate.message}`);
    if (gate.evidencePath) lines.push(`  - Evidence: \`${gate.evidencePath}\``);
  }

  lines.push(
    '',
    '## Diagnostic Packet',
    '',
    `- Packet: \`artifacts/diagnostic-packet.json\``,
    `- Blocker: \`${report.diagnosticPacket.blockerCategory}\``,
    '',
    '## Safety',
    '',
    'Doctor reports redact URLs, IPs, ports, connector material, provider/session tokens, grant handles, and raw prompt material.',
    'A pass does not publish or promote any release by itself; distribution remains gated by the signed installed-app proof policy.',
    ''
  );

  return `${lines.join('\n').trim()}\n`;
}

function takeoverMarkdown(report) {
  return [
    '# Mac Control Doctor Takeover',
    '',
    'Run from a current `100yenadmin/evaOS-GUI` beta-RC worktree after installing the signed candidate to `/Applications/evaOS Workbench.app`.',
    '',
    '```bash',
    `EVAOS_MAC_CONTROL_DOCTOR_EXPECTED_HEAD=${report.expectedHead} npm run evaos:mac-control-doctor`,
    '```',
    '',
    'Required live smoke command environment variables:',
    '',
    '- `EVAOS_MAC_CONTROL_DOCTOR_LOCAL_OPENCLAW_CMD`',
    '- `EVAOS_MAC_CONTROL_DOCTOR_VM_OPENCLAW_CMD`',
    '- `EVAOS_MAC_CONTROL_DOCTOR_HERMES_CMD`',
    '- `EVAOS_MAC_CONTROL_DOCTOR_STOP_REVOKE_CMD`',
    '- `EVAOS_MAC_CONTROL_DOCTOR_KILL_SWITCH_CMD`',
    '- `EVAOS_MAC_CONTROL_DOCTOR_POST_RESET_CMD`',
    '',
  ].join('\n');
}

function writeDoctorFiles(artifactRoot, report) {
  fs.mkdirSync(path.join(artifactRoot, 'artifacts', 'screenshots'), { recursive: true });
  const diagnosticPath = path.join(artifactRoot, 'artifacts', 'diagnostic-packet.json');
  const reportPath = path.join(artifactRoot, 'artifacts', 'mac-control-doctor-report.json');
  const proofPath = path.join(artifactRoot, 'proof.md');
  const takeoverPath = path.join(artifactRoot, 'takeover.md');

  fs.writeFileSync(diagnosticPath, `${JSON.stringify(report.diagnosticPacket, null, 2)}\n`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(proofPath, renderMarkdown(report));
  fs.writeFileSync(takeoverPath, takeoverMarkdown(report));

  assertNoUnsafeDoctorOutput(fs.readFileSync(diagnosticPath, 'utf8'));
  assertNoUnsafeDoctorOutput(fs.readFileSync(reportPath, 'utf8'));
  assertNoUnsafeDoctorOutput(fs.readFileSync(proofPath, 'utf8'));
  assertNoUnsafeDoctorOutput(fs.readFileSync(takeoverPath, 'utf8'));

  return { diagnosticPath, reportPath, proofPath, takeoverPath };
}

function buildDryRunGates() {
  return GATE_IDS.map((id) => pendingGate(id));
}

async function runMacControlDoctor(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '..');
  const repoHead = options.repoHead || gitHead(repoRoot);
  const expectedHead =
    options.expectedHead ||
    process.env.EVAOS_MAC_CONTROL_DOCTOR_EXPECTED_HEAD ||
    process.env.EVAOS_INSTALLED_APP_PROOF_EXPECTED_HEAD ||
    repoHead;
  const appPath = options.appPath || installedProof.DEFAULT_APP_PATH;
  const artifactRoot = options.artifactRoot || artifactRootForHead(expectedHead, process.env);
  const supportAccount =
    options.supportAccount || process.env.EVAOS_MAC_CONTROL_DOCTOR_ACCOUNT || DEFAULT_SUPPORT_ACCOUNT;
  const supportTarget = options.supportTarget || process.env.EVAOS_MAC_CONTROL_DOCTOR_TARGET || DEFAULT_SUPPORT_TARGET;
  const customerId = options.customerId || process.env.EVAOS_MAC_CONTROL_DOCTOR_CUSTOMER_ID;
  const customerLabel = options.customerLabel || process.env.EVAOS_MAC_CONTROL_DOCTOR_CUSTOMER_LABEL || supportTarget;
  const timeout = options.timeout || Number(process.env.EVAOS_MAC_CONTROL_DOCTOR_TIMEOUT || DEFAULT_TIMEOUT_MS);
  const proofTimeout =
    options.proofTimeout ||
    Number(process.env.EVAOS_MAC_CONTROL_DOCTOR_AGENT_TIMEOUT || DEFAULT_AGENT_PROOF_TIMEOUT_MS);
  const bridgePath = bridgePathForApp(appPath);

  installedProof.assertCanonicalProofAppPath(appPath, { allowNonCanonicalAppPath: options.allowNonCanonicalAppPath });

  let gates = [];
  let bundleInfo = {
    bundleId: installedProof.DEFAULT_BUNDLE_ID,
    bundleName: installedProof.DEFAULT_EXECUTABLE_NAME,
    bundleVersion: '0.0.0',
    shortVersion: '0.0.0',
    protocolSchemes: [installedProof.DEFAULT_PROTOCOL_SCHEME],
  };
  let desktopProofState = null;
  let installedProofResult = null;

  if (options.dryRun) {
    gates = buildDryRunGates();
  } else {
    try {
      installedProofResult = await installedProof.captureInstalledAppProof({
        repoRoot,
        repoHead,
        expectedHead,
        appPath,
        artifactRoot: path.join(artifactRoot, 'installed-app-proof'),
        timeout,
      });
      bundleInfo = installedProofResult.report.bundleInfo;
      desktopProofState = installedProofResult.report.desktopProofState;
      gates.push(
        passedGate('installed_app_preflight', 'Installed app product proof passed.', {
          evidencePath: path.relative(artifactRoot, installedProofResult.files.reportPath),
        })
      );
    } catch (error) {
      gates.push(
        failedGate('installed_app_preflight', 'not_workbench_managed', 'Installed app product proof failed.', {
          data: { message: sanitizeText(error?.message || String(error)) },
        })
      );
    }

    gates.push(
      runComputerUseEvidenceGate({
        computerUseEvidencePath: options.computerUseEvidencePath,
        supportAccount,
        supportTarget,
      })
    );

    if (!desktopProofState && options.desktopProofState) {
      desktopProofState = options.desktopProofState;
    }
    if (!desktopProofState && fs.existsSync(appPath)) {
      desktopProofState = installedProof.inspectDesktopProofState(appPath);
    }
    if (fs.existsSync(appPath)) {
      bundleInfo = installedProof.readInfoPlist(appPath);
    }

    gates.push(runBridgeReadyGate(appPath, { timeout, desktopProofState }));

    if (options.skipUi) {
      gates.push(blockedGate('support_account_target', 'runtime_not_configured', 'UI proof skipped by option.'));
      gates.push(blockedGate('route_visibility', 'runtime_not_configured', 'UI proof skipped by option.'));
      gates.push(blockedGate('visible_agent_mac_tools', 'runtime_not_configured', 'UI proof skipped by option.'));
      gates.push(blockedGate('mac_control_cold_start', 'runtime_not_configured', 'UI proof skipped by option.'));
    } else {
      gates.push(
        ...(await runUiProductGates({
          appPath,
          artifactRoot,
          timeout,
          supportAccount,
          supportTarget,
          chatPrompt:
            options.chatPrompt || process.env.EVAOS_MAC_CONTROL_DOCTOR_CHAT_PROMPT || VISIBLE_AGENT_MAC_TOOL_PROMPT,
          proofTimeout,
          agentKey: options.agentKey || process.env.EVAOS_MAC_CONTROL_DOCTOR_AGENT_KEY,
          agentType: options.agentType || process.env.EVAOS_MAC_CONTROL_DOCTOR_AGENT_TYPE,
        }))
      );
    }

    gates.push(
      runConfiguredCommandGate('local_openclaw', 'EVAOS_MAC_CONTROL_DOCTOR_LOCAL_OPENCLAW_CMD', process.env, {
        cwd: repoRoot,
        timeout,
      })
    );
    gates.push(
      runConfiguredCommandGate('vm_openclaw', 'EVAOS_MAC_CONTROL_DOCTOR_VM_OPENCLAW_CMD', process.env, {
        cwd: repoRoot,
        timeout,
      })
    );
    gates.push(
      runConfiguredCommandGate('hermes', 'EVAOS_MAC_CONTROL_DOCTOR_HERMES_CMD', process.env, {
        cwd: repoRoot,
        timeout,
      })
    );
    gates.push(
      runConfiguredCommandGate('stop_revoke', 'EVAOS_MAC_CONTROL_DOCTOR_STOP_REVOKE_CMD', process.env, {
        cwd: repoRoot,
        timeout,
      })
    );
    gates.push(
      runConfiguredCommandGate('kill_switch', 'EVAOS_MAC_CONTROL_DOCTOR_KILL_SWITCH_CMD', process.env, {
        cwd: repoRoot,
        timeout,
      })
    );
    gates.push(
      runConfiguredCommandGate('post_reset_recovery', 'EVAOS_MAC_CONTROL_DOCTOR_POST_RESET_CMD', process.env, {
        cwd: repoRoot,
        timeout,
      })
    );
  }

  const diagnosticPacket = buildDiagnosticPacket(
    {
      expectedHead,
      appPath,
      supportAccount,
      supportTarget,
      customerId,
      customerLabel,
    },
    gates,
    {
      bridgePath,
      bundleInfo,
      desktopProofState,
    }
  );

  const report = sanitizeValue({
    schema: REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    mode: options.dryRun ? 'dry-run' : 'live',
    repoHead,
    expectedHead,
    expectedShortHead: shortHead(expectedHead),
    appPath,
    bridgePath,
    artifactRoot,
    support: {
      account: supportAccount,
      target: supportTarget,
      customerId,
      customerLabel,
    },
    gates,
    overallStatus: overallStatus(gates),
    diagnosticPacket,
  });

  const files = writeDoctorFiles(artifactRoot, report);
  return { artifactRoot, report, files };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--skip-ui') options.skipUi = true;
    else if (arg === '--allow-noncanonical-app-path') options.allowNonCanonicalAppPath = true;
    else if (arg === '--app') options.appPath = argv[++index];
    else if (arg === '--artifact-root') options.artifactRoot = argv[++index];
    else if (arg === '--repo-root') options.repoRoot = argv[++index];
    else if (arg === '--expected-head') options.expectedHead = argv[++index];
    else if (arg === '--support-account') options.supportAccount = argv[++index];
    else if (arg === '--support-target') options.supportTarget = argv[++index];
    else if (arg === '--customer-id') options.customerId = argv[++index];
    else if (arg === '--customer-label') options.customerLabel = argv[++index];
    else if (arg === '--computer-use-evidence') options.computerUseEvidencePath = argv[++index];
    else if (arg === '--chat-prompt') options.chatPrompt = argv[++index];
    else if (arg === '--timeout') options.timeout = Number(argv[++index]);
    else if (arg === '--agent-proof-timeout') options.proofTimeout = Number(argv[++index]);
    else if (arg === '--agent-key') options.agentKey = argv[++index];
    else if (arg === '--agent-type') options.agentType = argv[++index];
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function helpText() {
  return [
    'Usage: node scripts/evaosMacControlDoctor.js [--dry-run] [--app <path>] [--expected-head <sha>]',
    '',
    'Runs the composed Mac-control release proof harness against /Applications/evaOS Workbench.app.',
    'Live mode fails closed unless exact installed app proof, Computer Use evidence, support target UI proof, visible agent Mac-tool proof,',
    'Mac & iPhone cold-start, bridge /ready, OpenClaw, Hermes, stop/revoke, kill-switch, and post-reset gates pass.',
    '',
    'Required live smoke command environment variables:',
    '  EVAOS_MAC_CONTROL_DOCTOR_LOCAL_OPENCLAW_CMD',
    '  EVAOS_MAC_CONTROL_DOCTOR_VM_OPENCLAW_CMD',
    '  EVAOS_MAC_CONTROL_DOCTOR_HERMES_CMD',
    '  EVAOS_MAC_CONTROL_DOCTOR_STOP_REVOKE_CMD',
    '  EVAOS_MAC_CONTROL_DOCTOR_KILL_SWITCH_CMD',
    '  EVAOS_MAC_CONTROL_DOCTOR_POST_RESET_CMD',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  const result = await runMacControlDoctor(options);
  console.log(`[evaos-mac-control-doctor] wrote ${result.files.reportPath}`);

  if (!options.dryRun && result.report.overallStatus !== 'passed') {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[evaos-mac-control-doctor] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_ARTIFACT_BASE,
  DEFAULT_SUPPORT_ACCOUNT,
  DEFAULT_SUPPORT_TARGET,
  DIAGNOSTIC_SCHEMA_VERSION,
  GATE_IDS,
  REPORT_SCHEMA,
  ROUTE_MARKERS,
  REQUIRED_VISIBLE_AGENT_MAC_TOOLS,
  VISIBLE_AGENT_LOW_IMPACT_ACTION,
  VISIBLE_AGENT_FAILURE_PATTERN,
  VISIBLE_AGENT_MAC_TOOL_PROMPT,
  OS_PERMISSION_PROMPT_PATTERN,
  artifactRootForHead,
  assertNoUnsafeDoctorOutput,
  bridgePathForApp,
  buildDiagnosticPacket,
  buildDryRunGates,
  captureVisibleAgentFailureState,
  ensureAdminRouteSurfaceVisible,
  gateStatus,
  macControlReadyTextSatisfied,
  overallStatus,
  parseArgs,
  renderMarkdown,
  runBridgeReadyGate,
  runConfiguredCommandGate,
  runComputerUseEvidenceGate,
  runMacControlDoctor,
  runVisibleAgentMacToolEvidenceGate,
  sanitizeText,
  sanitizeValue,
  visibleAgentEvidenceText,
};
