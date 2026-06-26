#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const installedProof = require('./evaosInstalledAppProductProof.js');
const { scanSecretEvidence } = require('./evaosShellSecretEvidenceAudit.js');

const REPORT_SCHEMA = 'evaos-mac-control-doctor/v1';
const DIAGNOSTIC_SCHEMA_VERSION = 'evaos.workbench.diagnostic_packet.v1';
const DEFAULT_ARTIFACT_BASE = '/Volumes/LEXAR/Codex/evidence/evaos-mac-control-doctor';
const DEFAULT_SUPPORT_ACCOUNT = 'admin@electricsheephq.com';
const DEFAULT_SUPPORT_TARGET = 'Support VM';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_COMMAND_OUTPUT = 8_000;

const GATE_IDS = [
  'installed_app_preflight',
  'computer_use_evidence',
  'support_account_target',
  'route_visibility',
  'new_chat_response',
  'mac_control_cold_start',
  'bridge_ready',
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

function runShellCommand(command, options = {}) {
  const result = spawnSync('/bin/zsh', ['-lc', command], {
    cwd: options.cwd || path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: options.timeout || DEFAULT_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      ...options.env,
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

function runConfiguredCommandGate(id, envName, env = process.env, options = {}) {
  const command = env[envName];
  if (!command || !String(command).trim()) {
    return blockedGate(id, 'runtime_not_configured', `${envName} is required for ${id} proof.`, {
      command: `${envName}=<command>`,
    });
  }

  const result = runShellCommand(command, options);
  if (result.status === 0 && !result.signal && !result.error) {
    return passedGate(id, `${id} command completed.`, {
      command,
      data: result,
    });
  }

  return failedGate(id, 'runtime_not_configured', `${id} command failed.`, {
    command,
    data: result,
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
    { name: 'new-chat', pattern: /new chat|assistant response|thought complete/i },
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
  const stdout = sanitizeText(result.stdout || '').slice(0, MAX_COMMAND_OUTPUT);
  const stderr = sanitizeText(result.stderr || '').slice(0, MAX_COMMAND_OUTPUT);
  const parsed = parseJsonMaybe(result.stdout || '');
  const ok = result.status === 0 && !result.signal && parsed?.ok !== false;

  if (ok) {
    return passedGate('bridge_ready', 'Bundled bridge /ready check passed.', {
      command: `${bridgePath} ready --json`,
      data: { stdout, stderr, ready: sanitizeValue(parsed) },
    });
  }

  return failedGate('bridge_ready', 'bridge_diagnostics_unavailable', 'Bundled bridge /ready check failed.', {
    command: `${bridgePath} ready --json`,
    data: {
      status: result.status,
      signal: result.signal,
      stdout,
      stderr,
      error: result.error ? sanitizeText(result.error.message) : undefined,
      ready: sanitizeValue(parsed),
    },
  });
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

async function navigateHash(page, route, timeout) {
  const expectedHash = route.startsWith('#') ? route : `#${route}`;
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, expectedHash);
  await page.waitForFunction((hash) => window.location.hash === hash, expectedHash, { timeout });
  await page.waitForLoadState('domcontentloaded');
}

async function sendChatProbe(page, timeout, prompt) {
  const input = page.locator('textarea, [contenteditable="true"]').first();
  await input.waitFor({ state: 'visible', timeout });
  await input.fill(prompt).catch(async () => {
    await input.click();
    await page.keyboard.insertText(prompt);
  });

  const sendButton = page
    .getByRole('button')
    .filter({ hasText: /^$|send|submit|start|arrow/i })
    .last();
  await sendButton.click().catch(async () => {
    await page.keyboard.press('Enter');
  });

  await waitForBodyText(page, prompt, timeout);
  await page.waitForFunction(
    (submittedPrompt) => {
      const text = document.body?.innerText || '';
      if (/USER_AGENT_STARTUP_FAILED|agent type is no longer supported|selected agent failed to start/i.test(text)) {
        throw new Error('New Chat rendered an agent startup failure.');
      }
      return text.includes(submittedPrompt) && /Thought complete|assistant|done|response|completed/i.test(text);
    },
    prompt,
    { timeout }
  );
}

async function runUiProductGates(options) {
  const appPath = options.appPath || installedProof.DEFAULT_APP_PATH;
  const executablePath = installedProof.installedExecutablePath(appPath);
  const artifactRoot = options.artifactRoot;
  const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
  const supportAccount = options.supportAccount || DEFAULT_SUPPORT_ACCOUNT;
  const supportTarget = options.supportTarget || DEFAULT_SUPPORT_TARGET;
  const chatPrompt = options.chatPrompt || 'ping';
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
        AIONUI_E2E_TEST: '1',
        AIONUI_CDP_PORT: '0',
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
      await navigateHash(page, '/home', timeout);
      await sendChatProbe(page, timeout, chatPrompt);
      const screenshot = 'screenshots/new-chat-response.png';
      await page.screenshot({ path: path.join(artifactRoot, 'artifacts', screenshot), fullPage: true });
      gates.push(
        passedGate('new_chat_response', 'New Chat produced a visible assistant response.', {
          evidencePath: `artifacts/${screenshot}`,
        })
      );
    } catch (error) {
      gates.push(
        failedGate('new_chat_response', 'agent_cli_config_invalid', 'New Chat response proof failed.', {
          data: await captureUiFailure(page, artifactRoot, 'new_chat_response', error),
        })
      );
    }

    try {
      await navigateHash(page, '/native-companion', timeout);
      const turnOn = page.getByRole('button', { name: /Turn On Mac Access/i }).first();
      if (await turnOn.isVisible().catch(() => false)) {
        await turnOn.click();
      }
      const setupCheck = page.getByRole('button', { name: /Run Setup Check/i }).first();
      if (await setupCheck.isVisible().catch(() => false)) {
        await setupCheck.click();
      }
      await waitForBodyText(page, 'Mac control', timeout);
      await page.waitForFunction(
        () => {
          const text = document.body?.innerText || '';
          if (/Create Pairing Prompt|Reconnect Workbench|needs Mac pairing/i.test(text)) return false;
          return /Mac control is ready|Mac control ready|Mac & iPhone/.test(text) && /ready/i.test(text);
        },
        undefined,
        { timeout }
      );
      const screenshot = 'screenshots/mac-control-cold-start.png';
      await page.screenshot({ path: path.join(artifactRoot, 'artifacts', screenshot), fullPage: true });
      gates.push(
        passedGate('mac_control_cold_start', 'Mac & iPhone cold-start reached no-code ready state.', {
          evidencePath: `artifacts/${screenshot}`,
        })
      );
    } catch (error) {
      gates.push(
        failedGate('mac_control_cold_start', 'connector_service_not_ready', 'Mac control cold-start proof failed.', {
          data: await captureUiFailure(page, artifactRoot, 'mac_control_cold_start', error),
        })
      );
    }
  } finally {
    await electronApp?.close().catch(() => undefined);
  }

  return gates;
}

function buildDiagnosticPacket(options, gates, extras = {}) {
  const failedOrBlocked = gates.find((gate) => gate.status === 'failed' || gate.status === 'blocked');
  const blockerCategory = failedOrBlocked?.reasonCode || 'unknown';
  const launchAgent = extras.desktopProofState?.launchAgent || {};
  const bundleInfo = extras.bundleInfo || {};

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
      evaos: gateStatus(gates, 'new_chat_response'),
      openclaw: gateStatus(gates, 'local_openclaw'),
      hermes: gateStatus(gates, 'hermes'),
      localAcp: gateStatus(gates, 'new_chat_response'),
      lastStartupCategory: blockerCategory,
    },
    brokerGrant: {
      state: gateStatus(gates, 'bridge_ready'),
      agentPairingStatus: gateStatus(gates, 'mac_control_cold_start') === 'passed' ? 'agent_paired' : 'not_ready',
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
      status: gateStatus(gates, 'mac_control_cold_start') === 'passed' ? 'ready' : 'repair_required',
      ownerClassification:
        gateStatus(gates, 'mac_control_cold_start') === 'passed' ? 'workbench_managed' : blockerCategory,
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

    if (!desktopProofState && fs.existsSync(appPath)) {
      desktopProofState = installedProof.inspectDesktopProofState(appPath);
    }
    if (fs.existsSync(appPath)) {
      bundleInfo = installedProof.readInfoPlist(appPath);
    }

    if (options.skipUi) {
      gates.push(blockedGate('support_account_target', 'runtime_not_configured', 'UI proof skipped by option.'));
      gates.push(blockedGate('route_visibility', 'runtime_not_configured', 'UI proof skipped by option.'));
      gates.push(blockedGate('new_chat_response', 'runtime_not_configured', 'UI proof skipped by option.'));
      gates.push(blockedGate('mac_control_cold_start', 'runtime_not_configured', 'UI proof skipped by option.'));
    } else {
      gates.push(
        ...(await runUiProductGates({
          appPath,
          artifactRoot,
          timeout,
          supportAccount,
          supportTarget,
          chatPrompt: options.chatPrompt || process.env.EVAOS_MAC_CONTROL_DOCTOR_CHAT_PROMPT || 'ping',
        }))
      );
    }

    gates.push(runBridgeReadyGate(appPath, { timeout }));
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
    'Live mode fails closed unless exact installed app proof, Computer Use evidence, support target UI proof, New Chat response,',
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
  artifactRootForHead,
  assertNoUnsafeDoctorOutput,
  bridgePathForApp,
  buildDiagnosticPacket,
  buildDryRunGates,
  gateStatus,
  overallStatus,
  parseArgs,
  renderMarkdown,
  runConfiguredCommandGate,
  runComputerUseEvidenceGate,
  runMacControlDoctor,
  sanitizeText,
  sanitizeValue,
};
