#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { GOLDEN_WORKBENCH_INSTALLED_PROOF_MANIFEST } = require('./evaosInstalledProofManifest.js');
const { SETTLED_SHELL_SCREENSHOT_PLAN } = require('./evaosSettledShellSmokePlan.js');

const DEFAULT_APP_PATH = '/Applications/evaOS Workbench.app';
const DEFAULT_EXECUTABLE_NAME = 'evaOS Workbench';
const DEFAULT_BUNDLE_ID = 'com.evaos.workbench';
const DEFAULT_PROTOCOL_SCHEME = 'evaos-workbench';
const WORKBENCH_BUNDLE_IDS = [DEFAULT_BUNDLE_ID, 'com.evaos.workbench.beta'];
const LEXAR_CODEX_PREFIX = '/Volumes/LEXAR/Codex/';
const BRIDGE_LAUNCH_AGENT_LABEL = 'com.electricsheep.evaos-desktop-bridge';
const BRIDGE_LISTENER_PORT = '8765';
const PACKAGED_BRIDGE_BOOTSTRAP =
  'import runpy, sys; source_root = sys.argv.pop(1); module = sys.argv.pop(1); sys.path.insert(0, source_root); runpy.run_module(module, run_name="__main__", alter_sys=True)';
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ARTIFACT_BASE = '/Volumes/LEXAR/Codex/aionui-rd/2026-06-public-beta/67-real-admin-product-reality-pass';
const REPORT_SCHEMA = 'evaos-installed-app-product-proof/v1';
const DEFAULT_TIMEOUT_MS = 25_000;
const LSREGISTER_PATH =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const LSREGISTER_DUMP_MAX_BUFFER = 64 * 1024 * 1024;
const MAC_CONTROL_OUT_OF_SCOPE_PARITY_ROWS = ['approvals', 'design-workspace', 'creative-studio'];

const UNSAFE_PROOF_PATTERNS = [
  { name: 'desktop_session', pattern: /desktop_session/i },
  { name: 'Bearer', pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+/i },
  { name: 'provider_grant', pattern: /provider_grant/i },
  { name: 'grant_handle', pattern: /grant_handle/i },
  { name: 'access_token', pattern: /access_token/i },
  { name: 'refresh_token', pattern: /refresh_token/i },
  { name: 'api_key', pattern: /api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{8,}/i },
  { name: 'tokenized_url', pattern: /[?&](token|jwt|desktop_session|access_token|refresh_token)=/i },
];

function shortHead(head) {
  return String(head || '')
    .trim()
    .slice(0, 12);
}

function installedExecutablePath(appPath = DEFAULT_APP_PATH) {
  return path.join(appPath, 'Contents', 'MacOS', DEFAULT_EXECUTABLE_NAME);
}

function assertCanonicalProofAppPath(appPath, options = {}) {
  const candidate = String(appPath || '').trim();
  if (!candidate) {
    throw new Error(`Installed app proof requires an exact .app path; expected ${DEFAULT_APP_PATH}.`);
  }
  if (!path.isAbsolute(candidate)) {
    throw new Error(
      `Installed app proof app target must be an absolute .app path, not ${candidate}. Use ${DEFAULT_APP_PATH}.`
    );
  }
  if (!candidate.endsWith('.app')) {
    throw new Error(
      `Installed app proof app target must be an exact .app path, not ${candidate}. Do not use a bundle identifier such as ${DEFAULT_BUNDLE_ID}.`
    );
  }
  if (!options.allowNonCanonicalAppPath && candidate !== DEFAULT_APP_PATH) {
    throw new Error(
      `Release proof must target ${DEFAULT_APP_PATH}; got ${candidate}. A separate beta path requires an explicit channel policy update.`
    );
  }
}

function artifactRootForHead(head, env = process.env) {
  if (env.EVAOS_INSTALLED_APP_PROOF_ROOT) {
    return env.EVAOS_INSTALLED_APP_PROOF_ROOT;
  }

  return path.join(DEFAULT_ARTIFACT_BASE, `current-head-${shortHead(head)}`, 'installed-app-proof');
}

function gitHead(repoRoot = DEFAULT_REPO_ROOT) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function packageVersion(repoRoot = DEFAULT_REPO_ROOT) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version || 'unknown';
}

function plistPathForApp(appPath) {
  return path.join(appPath, 'Contents', 'Info.plist');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodePlistXmlValue(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function plistXmlStringValue(xml, key) {
  const pattern = new RegExp(`<key>\\s*${escapeRegExp(key)}\\s*<\\/key>\\s*<string>([\\s\\S]*?)<\\/string>`);
  const match = String(xml || '').match(pattern);
  if (!match) {
    return '';
  }
  return decodePlistXmlValue(match[1].trim());
}

function plistXmlStringArrayValue(xml, key) {
  const pattern = new RegExp(`<key>\\s*${escapeRegExp(key)}\\s*<\\/key>\\s*<array>([\\s\\S]*?)<\\/array>`);
  const match = String(xml || '').match(pattern);
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/<string>([\s\S]*?)<\/string>/g)]
    .map((entry) => decodePlistXmlValue(entry[1].trim()))
    .filter(Boolean);
}

function readInfoPlistXmlFallback(appPath) {
  const xml = fs.readFileSync(plistPathForApp(appPath), 'utf8');
  return {
    bundleId: plistXmlStringValue(xml, 'CFBundleIdentifier'),
    bundleName: plistXmlStringValue(xml, 'CFBundleName'),
    bundleVersion: plistXmlStringValue(xml, 'CFBundleVersion'),
    shortVersion: plistXmlStringValue(xml, 'CFBundleShortVersionString'),
    protocolSchemes: plistXmlStringArrayValue(xml, 'CFBundleURLSchemes'),
  };
}

function isMissingPlistBuddyError(error) {
  return error?.code === 'ENOENT' && String(error?.path || '').includes('PlistBuddy');
}

function plistPrint(appPath, key, execFileSyncImpl = execFileSync) {
  return String(
    execFileSyncImpl('/usr/libexec/PlistBuddy', ['-c', key, plistPathForApp(appPath)], { encoding: 'utf8' })
  ).trim();
}

function parsePlistArrayOutput(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== 'Array {' && line !== '}')
    .map((line) => line.replace(/^"|"$/g, ''));
}

function readInfoPlist(appPath, execFileSyncImpl = execFileSync) {
  try {
    const schemes = parsePlistArrayOutput(
      plistPrint(appPath, 'Print:CFBundleURLTypes:0:CFBundleURLSchemes', execFileSyncImpl)
    );

    return {
      bundleId: plistPrint(appPath, 'Print:CFBundleIdentifier', execFileSyncImpl),
      bundleName: plistPrint(appPath, 'Print:CFBundleName', execFileSyncImpl),
      bundleVersion: plistPrint(appPath, 'Print:CFBundleVersion', execFileSyncImpl),
      shortVersion: plistPrint(appPath, 'Print:CFBundleShortVersionString', execFileSyncImpl),
      protocolSchemes: schemes,
    };
  } catch (error) {
    if (!isMissingPlistBuddyError(error)) {
      throw error;
    }
    return readInfoPlistXmlFallback(appPath);
  }
}

function assertMacVersionString(value, label) {
  if (!/^\d+\.\d+\.\d+$/.test(String(value || ''))) {
    throw new Error(`${label} must be three period-separated integers for macOS release proof, got ${value}.`);
  }
}

function assertMacBuildVersion(value, label) {
  if (!/^\d+(?:\.\d+){0,2}$/.test(String(value || ''))) {
    throw new Error(`${label} must be one to three numeric components for macOS release proof, got ${value}.`);
  }
}

function parseAppBundlePaths(output) {
  return uniqueStrings(
    String(output || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line.includes('.app'))
  );
}

function readIndexedWorkbenchApps(execFileSyncImpl = execFileSync) {
  const entries = [];
  for (const bundleId of WORKBENCH_BUNDLE_IDS) {
    let output = '';
    try {
      output = execFileSyncImpl('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == "${bundleId}"`], {
        encoding: 'utf8',
      });
    } catch (error) {
      entries.push({
        bundleId,
        path: null,
        status: 'unavailable',
        error: error?.message || String(error),
      });
      continue;
    }

    for (const indexedPath of parseAppBundlePaths(output)) {
      entries.push({
        bundleId,
        path: indexedPath,
        status: 'indexed',
      });
    }
  }

  return entries;
}

function parseRunningWorkbenchProcesses(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      return match ? { pid: match[1], command: match[2] } : { pid: null, command: line };
    })
    .filter((processInfo) => /\.app\/Contents\/MacOS\/(?:evaOS Workbench|EvaOSWorkbench)/.test(processInfo.command));
}

function readRunningWorkbenchProcesses(execFileSyncImpl = execFileSync) {
  try {
    return parseRunningWorkbenchProcesses(
      execFileSyncImpl('/bin/ps', ['-axo', 'pid=,command='], {
        encoding: 'utf8',
      })
    );
  } catch (error) {
    return [
      {
        pid: null,
        command: null,
        status: 'unavailable',
        error: error?.message || String(error),
      },
    ];
  }
}

function parseBridgeListenerPids(output) {
  return uniqueStrings(
    String(output || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /^\d+$/.test(line))
  );
}

function readProcessCommand(pid, execFileSyncImpl = execFileSync) {
  return String(execFileSyncImpl('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })).trim();
}

function readProcessExecutable(pid, execFileSyncImpl = execFileSync) {
  return String(execFileSyncImpl('/bin/ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' })).trim();
}

function readProcessParentPid(pid, execFileSyncImpl = execFileSync) {
  return String(execFileSyncImpl('/bin/ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8' })).trim();
}

function redactProcessCommand(command) {
  if (!command) return command;
  return String(command)
    .replace(/(--host(?:=|\s+))\S+/g, '$1[redacted-host]')
    .replace(/(--port(?:=|\s+))\S+/g, '$1[redacted-port]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]')
    .replace(/https?:\/\/\S+/g, '[redacted-url]');
}

function commandLooksLikeBridgeServer(command, expectedBridgePath) {
  const text = String(command || '');
  const packagedBridgeInvocation = `-c ${PACKAGED_BRIDGE_BOOTSTRAP} ${path.join(
    path.dirname(expectedBridgePath),
    'src'
  )} evaos_desktop_bridge.host.cli serve`;
  return (
    text.includes(expectedBridgePath) ||
    /(?:^|\s)-m\s+evaos_desktop_bridge\.host\.cli\s+serve(?:\s|$)/.test(text) ||
    text.includes(packagedBridgeInvocation) ||
    /(?:^|\s)evaos-desktop-bridge(?:\s+serve(?:\s|$)|$)/.test(text)
  );
}

function parseLsofFieldOutput(output, field) {
  const prefix = String(field || '').slice(0, 1);
  return (
    String(output || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith(prefix)) || ''
  ).slice(1);
}

function readProcessCwd(pid, execFileSyncImpl = execFileSync) {
  const output = execFileSyncImpl('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    encoding: 'utf8',
  });
  return parseLsofFieldOutput(output, 'n') || null;
}

function expectedWorkbenchExecutableForBridgePath(expectedBridgePath) {
  const marker = '/Contents/Resources/Bridge/';
  const markerIndex = expectedBridgePath.indexOf(marker);
  if (markerIndex === -1) return null;
  const appPath = expectedBridgePath.slice(0, markerIndex);
  return installedExecutablePath(appPath);
}

function readBridgeListenerState(expectedBridgePath, execFileSyncImpl = execFileSync) {
  let pids = [];
  try {
    pids = parseBridgeListenerPids(
      execFileSyncImpl('/usr/sbin/lsof', ['-nP', `-iTCP:${BRIDGE_LISTENER_PORT}`, '-sTCP:LISTEN', '-t'], {
        encoding: 'utf8',
      })
    );
  } catch (error) {
    return {
      port: BRIDGE_LISTENER_PORT,
      status: 'not-listening',
      expectedBridgePath,
      owners: [],
      staleOwners: [],
      error: error?.message || String(error),
    };
  }

  const owners = pids.map((pid) => {
    try {
      const command = readProcessCommand(pid, execFileSyncImpl);
      const expectedBridgeRoot = path.dirname(expectedBridgePath);
      const expectedWorkbenchExecutable = expectedWorkbenchExecutableForBridgePath(expectedBridgePath);
      let cwd = null;
      let parentPid = null;
      let parentCommand = null;
      let parentExecutable = null;
      try {
        cwd = readProcessCwd(pid, execFileSyncImpl);
      } catch {
        cwd = null;
      }
      try {
        parentPid = readProcessParentPid(pid, execFileSyncImpl);
        parentCommand = parentPid ? readProcessCommand(parentPid, execFileSyncImpl) : null;
        parentExecutable = parentPid ? readProcessExecutable(parentPid, execFileSyncImpl) : null;
      } catch {
        parentPid = null;
        parentCommand = null;
        parentExecutable = null;
      }
      const commandMatchesExpectedBridgePath = command.includes(expectedBridgePath);
      const commandMatchesBridgeServer = commandLooksLikeBridgeServer(command, expectedBridgePath);
      const workbenchChildMatchesExpectedBridge =
        Boolean(cwd && cwd === expectedBridgeRoot) &&
        Boolean(expectedWorkbenchExecutable && parentExecutable === expectedWorkbenchExecutable) &&
        commandMatchesBridgeServer;
      return {
        pid,
        command: redactProcessCommand(command),
        cwd,
        parentPid,
        parentCommand: redactProcessCommand(parentCommand),
        parentExecutable,
        matchesExpectedBridge: commandMatchesExpectedBridgePath || workbenchChildMatchesExpectedBridge,
        ownershipSource: commandMatchesExpectedBridgePath
          ? 'process-command'
          : workbenchChildMatchesExpectedBridge
            ? 'workbench-child-cwd'
            : undefined,
      };
    } catch (error) {
      return {
        pid,
        command: null,
        matchesExpectedBridge: false,
        error: error?.message || String(error),
      };
    }
  });

  return {
    port: BRIDGE_LISTENER_PORT,
    status: owners.length > 0 ? 'listening' : 'not-listening',
    expectedBridgePath,
    owners,
    staleOwners: owners.filter((owner) => !owner.matchesExpectedBridge),
  };
}

/**
 * Extracts the bridge executable path from `launchctl` output.
 * Supports `program = <path>` entries and argument-only lines from the
 * LaunchAgent arguments block.
 *
 * @param {unknown} output Raw launchctl stdout.
 * @returns {string | null} Bridge executable path, or null when absent.
 */
function parseLaunchAgentBridgePath(output) {
  const text = String(output || '');
  const programMatch = text.match(/^\s*program\s*=\s*"?(\/[^\n"]*evaos-desktop-bridge)(?=$|[\s"])"?\s*$/m);
  if (programMatch) return programMatch[1];
  const argumentMatch = text.match(/^\s*(\/[^\n"]*evaos-desktop-bridge)(?=$|[\s"])\s*$/m);
  return argumentMatch ? argumentMatch[1] : null;
}

/**
 * Extracts the bridge LaunchAgent PID from `launchctl` output.
 * Supports `pid = <n>` from `launchctl print` and the
 * `<pid> <status> com.electricsheep.evaos-desktop-bridge` row from `launchctl list`.
 *
 * @param {string} output Raw launchctl stdout.
 * @returns {string | null} PID as a string, or null when absent.
 */
function parseLaunchAgentPid(output) {
  const text = String(output || '');
  const match =
    text.match(/^\s*pid\s*=\s*(\d+)\s*$/m) ||
    text.match(/^\s*(\d+)\s+-?\d+\s+com\.electricsheep\.evaos-desktop-bridge\s*$/m);
  return match ? match[1] : null;
}

function readLaunchAgentBridgeState(execFileSyncImpl = execFileSync) {
  let uid;
  try {
    uid = String(execFileSyncImpl('/usr/bin/id', ['-u'], { encoding: 'utf8' })).trim();
  } catch (error) {
    return {
      label: BRIDGE_LAUNCH_AGENT_LABEL,
      status: 'unavailable',
      bridgePath: null,
      error: error?.message || String(error),
    };
  }

  try {
    const output = execFileSyncImpl('/bin/launchctl', ['print', `gui/${uid}/${BRIDGE_LAUNCH_AGENT_LABEL}`], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    return {
      label: BRIDGE_LAUNCH_AGENT_LABEL,
      status: 'loaded',
      bridgePath: parseLaunchAgentBridgePath(output),
      pid: parseLaunchAgentPid(output),
    };
  } catch (error) {
    return {
      label: BRIDGE_LAUNCH_AGENT_LABEL,
      status: 'not-loaded',
      bridgePath: null,
      pid: null,
      error: error?.message || String(error),
    };
  }
}

function runTrustCommand(command, args, execFileSyncImpl = execFileSync) {
  try {
    const output = String(execFileSyncImpl(command, args, { encoding: 'utf8' }) || '').trim();
    return {
      ok: true,
      command: [command, ...args].join(' '),
      output,
    };
  } catch (error) {
    const output = String(error?.stdout || '').trim();
    const stderr = String(error?.stderr || '').trim();
    return {
      ok: false,
      command: [command, ...args].join(' '),
      output,
      stderr,
      error: error?.message || String(error),
    };
  }
}

function findPythonCacheFiles(rootPath) {
  const matches = [];
  if (!fs.existsSync(rootPath)) return matches;

  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__pycache__') {
          collectRelativeFiles(entryPath, rootPath, matches);
        } else {
          stack.push(entryPath);
        }
      } else if (entry.name.endsWith('.pyc') || entry.name.endsWith('.pyo')) {
        matches.push(path.relative(rootPath, entryPath));
      }
    }
  }

  return uniqueStrings(matches).sort();
}

function collectRelativeFiles(directory, rootPath, matches) {
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else matches.push(path.relative(rootPath, entryPath));
    }
  }
}

function inspectInstalledAppTrustState(appPath = DEFAULT_APP_PATH, execFileSyncImpl = execFileSync) {
  const receiptVerifierPath = path.join(appPath, 'Contents', 'Resources', 'Bridge', 'bin', 'evaos-ed25519-verify');
  let receiptVerifierPresent = false;
  let receiptVerifierNative = false;
  try {
    const metadata = fs.lstatSync(receiptVerifierPath);
    const header = fs.readFileSync(receiptVerifierPath).subarray(0, 4).toString('hex');
    receiptVerifierPresent = metadata.isFile() && !metadata.isSymbolicLink() && Boolean(metadata.mode & 0o111);
    receiptVerifierNative =
      receiptVerifierPresent &&
      new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']).has(
        header
      );
  } catch {
    receiptVerifierPresent = false;
    receiptVerifierNative = false;
  }
  return {
    codesign: runTrustCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], execFileSyncImpl),
    spctl: runTrustCommand(
      '/usr/sbin/spctl',
      ['--assess', '--type', 'execute', '--verbose', appPath],
      execFileSyncImpl
    ),
    pythonCacheFiles: findPythonCacheFiles(path.join(appPath, 'Contents', 'Resources', 'Bridge')),
    receiptVerifier: {
      path: receiptVerifierPath,
      present: receiptVerifierPresent,
      native: receiptVerifierNative,
      codesign: receiptVerifierPresent
        ? runTrustCommand('/usr/bin/codesign', ['--verify', '--strict', receiptVerifierPath], execFileSyncImpl)
        : { ok: false },
      architecture: receiptVerifierPresent
        ? runTrustCommand('/usr/bin/lipo', ['-archs', receiptVerifierPath], execFileSyncImpl)
        : { ok: false },
    },
  };
}

function assertInstalledAppTrustStateClean(state) {
  if (state.pythonCacheFiles.length > 0) {
    throw new Error(
      `Installed app bundle contains Python cache files that mutate the signed seal: ${state.pythonCacheFiles.join(
        ', '
      )}. Reinstall a fresh signed app before release proof.`
    );
  }
  if (!state.codesign?.ok) {
    throw new Error(
      `Installed app codesign verification failed. ${state.codesign?.stderr || state.codesign?.error || ''}`.trim()
    );
  }
  if (!state.spctl?.ok) {
    throw new Error(
      `Installed app Gatekeeper assessment failed. ${state.spctl?.stderr || state.spctl?.error || ''}`.trim()
    );
  }
  const expectedArchitecture = process.arch === 'x64' ? 'x86_64' : process.arch;
  if (
    state.receiptVerifier?.present !== true ||
    state.receiptVerifier?.native !== true ||
    state.receiptVerifier?.codesign?.ok !== true ||
    state.receiptVerifier?.architecture?.ok !== true ||
    state.receiptVerifier?.architecture?.output !== expectedArchitecture
  ) {
    throw new Error(
      `Installed app receipt verifier is missing, non-native, unsigned, or built for the wrong architecture: ${
        state.receiptVerifier?.path || 'unknown path'
      }.`
    );
  }
}

function inspectDesktopProofState(appPath = DEFAULT_APP_PATH, execFileSyncImpl = execFileSync) {
  const expectedBridgePath = path.join(appPath, 'Contents', 'Resources', 'Bridge', 'evaos-desktop-bridge');
  const indexedApps = readIndexedWorkbenchApps(execFileSyncImpl);
  const runningProcesses = readRunningWorkbenchProcesses(execFileSyncImpl);
  const launchAgent = readLaunchAgentBridgeState(execFileSyncImpl);
  const rawBridgeListener = readBridgeListenerState(expectedBridgePath, execFileSyncImpl);
  const bridgeListener = reconcileBridgeListenerWithLaunchAgent(rawBridgeListener, launchAgent, expectedBridgePath);
  const staleIndexedApps = indexedApps.filter(
    (entry) => entry.path && entry.path !== appPath && entry.path.startsWith(LEXAR_CODEX_PREFIX)
  );
  const staleRunningProcesses = runningProcesses.filter(
    (entry) => entry.command && entry.command.includes(`${LEXAR_CODEX_PREFIX}`) && !entry.command.includes(appPath)
  );
  const staleLaunchAgent = launchAgent.status === 'loaded' && launchAgent.bridgePath !== expectedBridgePath;

  return {
    expectedAppPath: appPath,
    expectedBridgePath,
    indexedApps,
    staleIndexedApps,
    runningProcesses,
    staleRunningProcesses,
    launchAgent,
    staleLaunchAgent,
    bridgeListener,
    staleBridgeListener: bridgeListener.staleOwners.length > 0,
  };
}

function reconcileBridgeListenerWithLaunchAgent(bridgeListener, launchAgent, expectedBridgePath) {
  if (
    !launchAgent ||
    launchAgent.status !== 'loaded' ||
    launchAgent.bridgePath !== expectedBridgePath ||
    !launchAgent.pid ||
    !Array.isArray(bridgeListener?.owners)
  ) {
    return bridgeListener;
  }

  const owners = bridgeListener.owners.map((owner) => {
    if (String(owner.pid || '') !== String(launchAgent.pid)) {
      return owner;
    }

    return {
      ...owner,
      matchesExpectedBridge: true,
      ownershipSource: 'launchagent-program',
    };
  });

  return {
    ...bridgeListener,
    owners,
    staleOwners: owners.filter((owner) => !owner.matchesExpectedBridge),
  };
}

function assertDesktopProofStateClean(state) {
  if (state.staleIndexedApps.length > 0) {
    throw new Error(
      `Spotlight indexes stale Workbench app bundles under ${LEXAR_CODEX_PREFIX}: ${state.staleIndexedApps
        .map((entry) => `${entry.bundleId}:${entry.path}`)
        .join(', ')}. Move proof extracts under .noindex or keep them zipped before release proof.`
    );
  }
  if (state.staleRunningProcesses.length > 0) {
    throw new Error(
      `Stale Workbench app processes are running outside ${state.expectedAppPath}: ${state.staleRunningProcesses
        .map((entry) => `${entry.pid || 'unknown'}:${entry.command}`)
        .join(', ')}. Stop stale extracted apps before Computer Use proof.`
    );
  }
  if (state.staleLaunchAgent) {
    throw new Error(
      `Workbench bridge LaunchAgent points to ${state.launchAgent.bridgePath || 'unknown program'}, expected ${state.expectedBridgePath}. Re-bootstrap the bundled bridge before Mac-control proof.`
    );
  }
  if (state.staleBridgeListener) {
    throw new Error(
      `Port ${state.bridgeListener.port} is owned by a non-candidate bridge process: ${state.bridgeListener.staleOwners
        .map((entry) => `${entry.pid || 'unknown'}:${entry.command || entry.error || 'unknown'}`)
        .join(', ')}. Stop the stale listener or reinstall the signed candidate before Mac-control proof.`
    );
  }
  if (state.bridgeListener?.status && state.bridgeListener.status !== 'listening') {
    throw new Error(
      `No live Workbench bridge listener is present on port ${state.bridgeListener.port || BRIDGE_LISTENER_PORT}. Start the bundled Workbench bridge before Mac-control proof.`
    );
  }
}

function compactLaunchServicesLine(line) {
  return String(line || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+\(0x[0-9a-f]+\)/i, '')
    .trim();
}

function parseLaunchServicesProtocolHandler(dump, scheme = DEFAULT_PROTOCOL_SCHEME) {
  const lines = String(dump || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const handlerMatch = line.match(/handlerpref id:\s+([^\s]+)/);
    if (!handlerMatch || handlerMatch[1] !== scheme) continue;

    const evidenceLines = [compactLaunchServicesLine(line)];
    let bundleId = null;
    for (let offset = index + 1; offset < lines.length; offset += 1) {
      const next = lines[offset];
      if (/^-{8,}/.test(next)) break;
      const compacted = compactLaunchServicesLine(next);
      if (!compacted) continue;
      const rolesMatch = next.match(/all roles:\s+([^\s]+)/);
      if (rolesMatch) {
        bundleId = rolesMatch[1];
        evidenceLines.push(`all roles: ${bundleId}`);
      } else if (/Electron\.app|node_modules\/\.bun\/electron|com\.github\.Electron/i.test(next)) {
        evidenceLines.push(compacted);
      }
    }

    return {
      scheme,
      bundleId,
      evidence: evidenceLines.join('; '),
    };
  }

  return {
    scheme,
    bundleId: null,
    evidence: `handlerpref id: ${scheme}; not found`,
  };
}

function readLaunchServicesProtocolHandler(scheme = DEFAULT_PROTOCOL_SCHEME, execFileSyncImpl = execFileSync) {
  const dump = execFileSyncImpl(LSREGISTER_PATH, ['-dump'], {
    encoding: 'utf8',
    maxBuffer: LSREGISTER_DUMP_MAX_BUFFER,
  });
  return parseLaunchServicesProtocolHandler(dump, scheme);
}

function assertExpectedProtocolHandler(handler) {
  const evidence = handler?.evidence || '';
  const bundleId = handler?.bundleId || '';
  if (
    bundleId === 'com.github.Electron' ||
    /Electron\.app|node_modules\/\.bun\/electron|\/node_modules\/electron/i.test(evidence)
  ) {
    throw new Error(
      `evaOS beta protocol ${DEFAULT_PROTOCOL_SCHEME} resolves to raw Electron instead of ${DEFAULT_BUNDLE_ID}. Evidence: ${evidence}`
    );
  }
  if (bundleId !== DEFAULT_BUNDLE_ID) {
    throw new Error(
      `evaOS beta protocol ${DEFAULT_PROTOCOL_SCHEME} resolves to ${bundleId || 'no handler'} instead of ${DEFAULT_BUNDLE_ID}. Evidence: ${evidence}`
    );
  }
}

function assertExpectedBundle(bundleInfo) {
  if (bundleInfo.bundleId !== DEFAULT_BUNDLE_ID) {
    throw new Error(`Installed app bundle id ${bundleInfo.bundleId} does not match ${DEFAULT_BUNDLE_ID}.`);
  }
  if (bundleInfo.bundleName !== DEFAULT_EXECUTABLE_NAME) {
    throw new Error(`Installed app bundle name ${bundleInfo.bundleName} does not match ${DEFAULT_EXECUTABLE_NAME}.`);
  }
  assertMacVersionString(bundleInfo.shortVersion, 'CFBundleShortVersionString');
  assertMacBuildVersion(bundleInfo.bundleVersion, 'CFBundleVersion');
  if (!bundleInfo.protocolSchemes.includes(DEFAULT_PROTOCOL_SCHEME)) {
    throw new Error(`Installed app protocol schemes do not include ${DEFAULT_PROTOCOL_SCHEME}.`);
  }
}

function normalizeWaitSelector(selector) {
  return String(selector).replace(/^body:text\((.*)\)$/, 'body:has-text($1)');
}

function markerSelector(marker) {
  return `body:has-text(${JSON.stringify(marker)})`;
}

function markerFromWaitSelector(selector) {
  const match = String(selector).match(/^body:has-text\("(.+)"\)$/);
  return match ? match[1] : null;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function screenshotPlanById() {
  return new Map(SETTLED_SHELL_SCREENSHOT_PLAN.map((entry) => [entry.id, entry]));
}

function normalizeInstalledProofEntries(plan, options = {}) {
  const expectedShortHead = shortHead(options.expectedHead);
  const screenshotEntriesById = screenshotPlanById();
  const isCustomPlan = Array.isArray(plan);
  const sourcePlan = isCustomPlan ? plan : GOLDEN_WORKBENCH_INSTALLED_PROOF_MANIFEST;

  return sourcePlan.map((entry) => {
    const screenshotEntry = screenshotEntriesById.get(entry.id);
    const baseWaitSelectors = Array.isArray(entry.waitSelectors) ? entry.waitSelectors : [];
    const settledMarkers = Array.isArray(entry.settledMarkers)
      ? [...entry.settledMarkers]
      : baseWaitSelectors.map(normalizeWaitSelector).map(markerFromWaitSelector).filter(Boolean);
    const markerSelectors = settledMarkers.map(markerSelector);
    const waitSelectors = uniqueStrings([...baseWaitSelectors.map(normalizeWaitSelector), ...markerSelectors]);

    if (entry.id === 'settings-about' && expectedShortHead) {
      const commitSelector = normalizeWaitSelector(`body:text("${expectedShortHead}")`);
      if (!waitSelectors.includes(commitSelector)) {
        waitSelectors.push(commitSelector);
      }
      if (!settledMarkers.includes(expectedShortHead)) {
        settledMarkers.push(expectedShortHead);
      }
    }

    return {
      manifestRowId: entry.manifestRowId || entry.id,
      id: entry.id,
      route: entry.route,
      hashRoute: entry.hashRoute,
      screenshot: entry.screenshot,
      artifactName: entry.artifactName || `screenshots/${entry.screenshot}`,
      action: entry.action,
      closeoutState: entry.closeoutState || 'loaded',
      settledMarkers,
      waitSelectors,
    };
  });
}

function buildInstalledProofPlan(plan, options = {}) {
  return normalizeInstalledProofEntries(plan, options);
}

function buildInstalledProofPreflightPlan(options = {}) {
  const expectedShortHead = shortHead(options.expectedHead);
  const settledMarkers = uniqueStrings(['About', 'Build identity', expectedShortHead]);

  return [
    {
      manifestRowId: 'exact-candidate-preflight',
      id: 'settings-about-current-candidate',
      route: '/settings/about',
      hashRoute: '/settings/model',
      screenshot: 'preflight-settings-about.png',
      artifactName: 'screenshots/preflight-settings-about.png',
      action: 'click-settings-about',
      closeoutState: 'loaded',
      settledMarkers,
      waitSelectors: settledMarkers.map(markerSelector),
    },
  ];
}

function assertNoUnsafeProofText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const { name, pattern } of UNSAFE_PROOF_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`Unsafe proof output contains ${name}.`);
    }
  }
}

function ensureProofDirs(artifactRoot) {
  fs.mkdirSync(path.join(artifactRoot, 'artifacts', 'screenshots'), { recursive: true });
}

function safeReportForPlan(options) {
  const plan = normalizeInstalledProofEntries(options.plan, { expectedHead: options.expectedHead });
  const preflightPlan = buildInstalledProofPreflightPlan({ expectedHead: options.expectedHead });
  const appStat =
    fs.existsSync(options.appPath) && fs.statSync(options.appPath).isDirectory()
      ? {
          mtimeMs: fs.statSync(options.appPath).mtimeMs,
          size: fs.statSync(options.appPath).size,
        }
      : null;

  return {
    schema: REPORT_SCHEMA,
    mode: options.mode || 'dry-run',
    generatedAt: new Date().toISOString(),
    repoHead: options.repoHead,
    expectedHead: options.expectedHead,
    expectedShortHead: shortHead(options.expectedHead),
    appPath: options.appPath,
    executablePath: options.executablePath,
    protocolHandler: options.protocolHandler || {
      scheme: DEFAULT_PROTOCOL_SCHEME,
      bundleId: null,
      evidence: 'not checked',
      status: 'not-checked',
    },
    appStat,
    packageVersion: options.packageVersion || 'unknown',
    bundleInfo: options.bundleInfo,
    desktopProofState: options.desktopProofState || null,
    installedAppTrustState: options.installedAppTrustState || null,
    proofScope: {
      claim: 'mac-control-scoped installed app proof',
      supportDiagnostics: 'enabled-by-harness-for-native-companion-matrix',
      includedRows: plan.map((entry) => entry.manifestRowId || entry.id),
      outOfScopeRows: [...MAC_CONTROL_OUT_OF_SCOPE_PARITY_ROWS],
    },
    screenshots: plan.map((entry) => ({
      id: entry.id,
      route: entry.route,
      screenshot: entry.artifactName,
      artifactName: entry.artifactName,
      closeoutState: entry.closeoutState,
      status: options.screenshotStatus || 'pending',
    })),
    preflightAssertions: preflightPlan.map((entry) => ({
      id: entry.id,
      manifestRowId: entry.manifestRowId,
      route: entry.route,
      artifactName: entry.artifactName,
      closeoutState: entry.closeoutState,
      settledMarkers: entry.settledMarkers,
      waitSelectors: entry.waitSelectors,
      status: options.screenshotStatus || 'pending',
    })),
    parityAssertions: plan.map((entry) => ({
      id: entry.id,
      manifestRowId: entry.manifestRowId,
      route: entry.route,
      artifactName: entry.artifactName,
      closeoutState: entry.closeoutState,
      settledMarkers: entry.settledMarkers,
      waitSelectors: entry.waitSelectors,
      status: options.screenshotStatus || 'pending',
    })),
    failure: options.failure || null,
  };
}

function markdownForInstalledProof(report) {
  return [
    '# Installed App Product Proof',
    '',
    `Schema: \`${REPORT_SCHEMA}\``,
    `Mode: \`${report.mode || 'live'}\``,
    `Expected commit: \`${shortHead(report.expectedHead)}\``,
    `Repo head: \`${shortHead(report.repoHead)}\``,
    `App path: \`${report.appPath}\``,
    `Executable: \`${report.executablePath}\``,
    '',
    '## Bundle Identity',
    '',
    `- Bundle ID: \`${report.bundleInfo.bundleId}\``,
    `- Bundle name: \`${report.bundleInfo.bundleName}\``,
    `- Bundle version: \`${report.bundleInfo.bundleVersion}\``,
    `- Short version: \`${report.bundleInfo.shortVersion}\``,
    `- Protocol schemes: \`${report.bundleInfo.protocolSchemes.join('`, `')}\``,
    '',
    '## Desktop Proof Hygiene',
    '',
    `- Expected app path: \`${report.desktopProofState?.expectedAppPath || report.appPath}\``,
    `- Indexed stale Workbench apps: \`${report.desktopProofState?.staleIndexedApps?.length || 0}\``,
    `- Stale running Workbench apps: \`${report.desktopProofState?.staleRunningProcesses?.length || 0}\``,
    `- Bridge LaunchAgent: \`${report.desktopProofState?.launchAgent?.status || 'not checked'}\``,
    `- Bridge path: \`${report.desktopProofState?.launchAgent?.bridgePath || 'none'}\``,
    `- Bridge listener: \`${report.desktopProofState?.bridgeListener?.status || 'not checked'}\``,
    `- Stale bridge listener owners: \`${report.desktopProofState?.bridgeListener?.staleOwners?.length || 0}\``,
    '',
    '## Installed App Trust',
    '',
    `- codesign verify: \`${report.installedAppTrustState?.codesign?.ok === true ? 'passed' : 'not checked'}\``,
    `- Gatekeeper spctl: \`${report.installedAppTrustState?.spctl?.ok === true ? 'passed' : 'not checked'}\``,
    `- Python cache files in signed bridge: \`${report.installedAppTrustState?.pythonCacheFiles?.length || 0}\``,
    '',
    '## Protocol Handler',
    '',
    `- Scheme: \`${report.protocolHandler?.scheme || DEFAULT_PROTOCOL_SCHEME}\``,
    `- Handler bundle: \`${report.protocolHandler?.bundleId || 'none'}\``,
    `- Status: \`${report.protocolHandler?.status || 'unknown'}\``,
    `- Evidence: ${report.protocolHandler?.evidence || 'not checked'}`,
    '',
    '## Exact Candidate Preflight',
    '',
    ...(report.preflightAssertions || []).map(
      (entry) => `- \`${entry.id}\` -> \`${entry.artifactName}\` (${entry.closeoutState}, ${entry.status})`
    ),
    '',
    '## Parity Assertions',
    '',
    ...(report.parityAssertions || report.screenshots).map(
      (shot) =>
        `- \`${shot.id}\` -> \`${shot.artifactName || shot.screenshot}\` (${shot.closeoutState}, ${shot.status})`
    ),
    '',
    ...(report.failure
      ? [
          '## Failure',
          '',
          `- Stage: \`${report.failure.stage}\``,
          `- ID: \`${report.failure.id}\``,
          `- Route: \`${report.failure.route}\``,
          `- Current hash: \`${report.failure.currentHash}\``,
          `- Screenshot: \`${report.failure.screenshot || 'none'}\``,
          `- Message: ${report.failure.message}`,
          '',
        ]
      : []),
    '## Safety',
    '',
    'Reports intentionally omit environment values, renderer state dumps, tokenized URLs, provider grants, and raw credentials.',
    '',
  ].join('\n');
}

function takeoverMarkdown(report) {
  const includedRows = report.proofScope?.includedRows || [];
  const outOfScopeRows = report.proofScope?.outOfScopeRows || MAC_CONTROL_OUT_OF_SCOPE_PARITY_ROWS;

  return [
    '# Takeover',
    '',
    'Run from `/Volumes/LEXAR/repos/AionUi-business-browser-context` or a current-head Lexar worktree after installing a fresh macOS beta candidate.',
    '',
    '```bash',
    `EVAOS_INSTALLED_APP_PROOF_EXPECTED_HEAD=${report.expectedHead} npm run evaos:installed-app-proof`,
    '```',
    '',
    'A pass means the installed app bundle identity matched, the About page exposed the expected commit, and each Mac-control-scoped installed proof row listed below reached its required loaded, denied, waived, or repair state before screenshot capture.',
    '',
    `Scoped rows: ${includedRows.map((id) => `\`${id}\``).join(', ') || '`none`'}.`,
    '',
    `Support diagnostics: \`${report.proofScope?.supportDiagnostics || 'not recorded'}\`.`,
    '',
    `Intentionally out of scope for this proof: ${outOfScopeRows.map((id) => `\`${id}\``).join(', ') || '`none`'}.`,
    '',
    'This takeover packet still does not prove visible first-party agent Mac-control tool calls, public updater/site distribution, unrelated customer VMs, or customer readiness.',
    '',
  ].join('\n');
}

function writeReportFiles(artifactRoot, report) {
  ensureProofDirs(artifactRoot);
  assertNoUnsafeProofText(report);

  const reportPath = path.join(artifactRoot, 'artifacts', 'installed-app-product-proof-report.json');
  const proofPath = path.join(artifactRoot, 'proof.md');
  const takeoverPath = path.join(artifactRoot, 'takeover.md');

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(proofPath, markdownForInstalledProof(report));
  fs.writeFileSync(takeoverPath, takeoverMarkdown(report));

  assertNoUnsafeProofText(fs.readFileSync(reportPath, 'utf8'));
  assertNoUnsafeProofText(fs.readFileSync(proofPath, 'utf8'));
  assertNoUnsafeProofText(fs.readFileSync(takeoverPath, 'utf8'));

  return { reportPath, proofPath, takeoverPath };
}

function writeDryRunProofFiles(options) {
  const report = safeReportForPlan({ ...options, mode: 'dry-run', screenshotStatus: 'pending' });
  return writeReportFiles(options.artifactRoot, report);
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

async function enableSupportDiagnosticsForProof(page, timeout = DEFAULT_TIMEOUT_MS) {
  await page.evaluate(() => {
    window.localStorage?.setItem('evaos.supportDiagnostics', '1');
  });
  await page.waitForFunction(() => window.localStorage?.getItem('evaos.supportDiagnostics') === '1', undefined, {
    timeout,
  });
}

async function runProofPlanAction(page, action, timeout = DEFAULT_TIMEOUT_MS) {
  if (!action) return;

  if (action === 'click-native-companion-advanced-diagnostics') {
    const advancedButton = page.getByRole('button', { name: /Advanced diagnostics/i }).first();
    await advancedButton.waitFor({ state: 'visible', timeout });
    await advancedButton.click();
    await page.waitForFunction(
      () => Boolean(globalThis.document?.body?.innerText?.includes('Native companion status matrix')),
      undefined,
      { timeout }
    );
    return;
  }

  if (action === 'click-settings-about') {
    const aboutTab = page.getByText('About', { exact: true }).first();
    await aboutTab.waitFor({ state: 'visible', timeout });
    await aboutTab.click();
    await page.waitForFunction(() => window.location.hash === '#/settings/about', undefined, { timeout });
    return;
  }

  if (action === 'click-company-brain-load') {
    const loadButton = page.getByRole('button', { name: /^Load$/i }).first();
    await loadButton.waitFor({ state: 'visible', timeout });
    await loadButton.click();
    await page.waitForFunction(
      () => Boolean(globalThis.document?.body?.innerText?.includes('Company Brain directory')),
      undefined,
      { timeout }
    );
    return;
  }

  throw new Error(`Installed app proof action is not allowlisted: ${action}`);
}

async function captureProofEntry(page, entry, artifactRoot, timeout) {
  const navigationRoute = entry.hashRoute || entry.route;
  const expectedHash = navigationRoute.startsWith('#') ? navigationRoute : `#${navigationRoute}`;
  await page.evaluate((route) => {
    window.location.hash = route.startsWith('#') ? route : `#${route}`;
  }, navigationRoute);
  await page.waitForFunction((hash) => window.location.hash === hash, expectedHash, { timeout });
  await page.waitForLoadState('domcontentloaded');
  await runProofPlanAction(page, entry.action, timeout);

  for (const selector of entry.waitSelectors) {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout });
  }

  const screenshotPath = path.join(artifactRoot, 'artifacts', 'screenshots', entry.screenshot);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  return {
    id: entry.id,
    manifestRowId: entry.manifestRowId,
    route: entry.route,
    hashRoute: entry.hashRoute,
    screenshot: entry.artifactName,
    artifactName: entry.artifactName,
    closeoutState: entry.closeoutState,
    settledMarkers: entry.settledMarkers,
    waitSelectors: entry.waitSelectors,
    status: 'passed',
  };
}

async function captureFailureProof(page, entry, artifactRoot, stage, error) {
  const failureScreenshot = `screenshots/${entry.id}-failure.png`;
  const screenshotPath = path.join(artifactRoot, 'artifacts', failureScreenshot);
  let currentHash = 'unavailable';

  if (page) {
    currentHash = await page.evaluate(() => window.location.hash).catch(() => 'unavailable');
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  }

  return {
    stage,
    id: entry.id,
    manifestRowId: entry.manifestRowId,
    route: entry.route,
    currentHash,
    expectedSelectors: entry.waitSelectors,
    screenshot: failureScreenshot,
    message: error?.message || String(error),
  };
}

async function captureInstalledAppProof(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const repoHead = options.repoHead || gitHead(repoRoot);
  const expectedHead = options.expectedHead || process.env.EVAOS_INSTALLED_APP_PROOF_EXPECTED_HEAD || repoHead;
  const appPath = options.appPath || DEFAULT_APP_PATH;
  const executablePath = options.executablePath || installedExecutablePath(appPath);
  const artifactRoot = options.artifactRoot || artifactRootForHead(expectedHead, process.env);
  const timeout = Number(options.timeout || process.env.EVAOS_INSTALLED_APP_PROOF_TIMEOUT || DEFAULT_TIMEOUT_MS);
  assertCanonicalProofAppPath(appPath, { allowNonCanonicalAppPath: options.allowNonCanonicalAppPath });

  if (!fs.existsSync(appPath)) {
    throw new Error(`Installed app not found: ${appPath}`);
  }
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Installed app executable not found: ${executablePath}`);
  }

  const bundleInfo = options.bundleInfo || readInfoPlist(appPath);
  assertExpectedBundle(bundleInfo);
  const installedAppTrustState = options.installedAppTrustState || inspectInstalledAppTrustState(appPath);
  assertInstalledAppTrustStateClean(installedAppTrustState);
  const desktopProofState = options.desktopProofState || inspectDesktopProofState(appPath);
  assertDesktopProofStateClean(desktopProofState);
  let protocolHandler = options.protocolHandler || readLaunchServicesProtocolHandler(DEFAULT_PROTOCOL_SCHEME);
  try {
    assertExpectedProtocolHandler(protocolHandler);
    protocolHandler = { ...protocolHandler, status: 'passed' };
  } catch (error) {
    protocolHandler = { ...protocolHandler, status: 'failed' };
    const failure = {
      stage: 'protocol-handler',
      id: 'evaos-beta-protocol-handler',
      route: `${DEFAULT_PROTOCOL_SCHEME}://`,
      currentHash: 'unavailable',
      expectedSelectors: [],
      screenshot: null,
      message: error?.message || String(error),
    };
    const report = safeReportForPlan({
      mode: 'live',
      repoHead,
      expectedHead,
      appPath,
      executablePath,
      packageVersion: packageVersion(repoRoot),
      bundleInfo,
      installedAppTrustState,
      desktopProofState,
      protocolHandler,
      plan: buildInstalledProofPlan(undefined, { expectedHead }),
      screenshotStatus: 'not-started',
      failure,
    });
    const files = writeReportFiles(artifactRoot, report);
    throw new Error(
      `Installed app proof failed during protocol handler check; wrote ${files.reportPath}: ${failure.message}`
    );
  }

  const preflightPlan = buildInstalledProofPreflightPlan({ expectedHead });
  const proofPlan = buildInstalledProofPlan(options.plan, { expectedHead });
  ensureProofDirs(artifactRoot);

  const { _electron: electron } = require('playwright');
  let electronApp;
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
        EVAOS_INSTALLED_APP_PROOF: '1',
        NODE_ENV: 'production',
      },
      timeout: 60_000,
    });
  } catch (error) {
    const failure = {
      stage: 'launch',
      id: 'installed-app-launch',
      route: 'app-launch',
      currentHash: 'unavailable',
      expectedSelectors: [],
      screenshot: null,
      message: error?.message || String(error),
    };
    const report = safeReportForPlan({
      mode: 'live',
      repoHead,
      expectedHead,
      appPath,
      executablePath,
      packageVersion: packageVersion(repoRoot),
      bundleInfo,
      installedAppTrustState,
      desktopProofState,
      protocolHandler,
      plan: proofPlan,
      screenshotStatus: 'not-started',
      failure,
    });
    const files = writeReportFiles(artifactRoot, report);
    throw new Error(`Installed app proof failed during launch; wrote ${files.reportPath}: ${failure.message}`);
  }

  const screenshots = [];
  const preflightAssertions = [];
  let failure = null;

  try {
    const page = await resolveMainWindow(electronApp);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await enableSupportDiagnosticsForProof(page, timeout);

    for (const entry of preflightPlan) {
      try {
        preflightAssertions.push(await captureProofEntry(page, entry, artifactRoot, timeout));
      } catch (error) {
        failure = await captureFailureProof(page, entry, artifactRoot, 'preflight', error);
        break;
      }
    }

    if (!failure) {
      for (const entry of proofPlan) {
        try {
          screenshots.push(await captureProofEntry(page, entry, artifactRoot, timeout));
        } catch (error) {
          failure = await captureFailureProof(page, entry, artifactRoot, 'parity', error);
          break;
        }
      }
    }
  } finally {
    await electronApp.close().catch(() => undefined);
  }

  const report = {
    schema: REPORT_SCHEMA,
    mode: 'live',
    generatedAt: new Date().toISOString(),
    repoHead,
    expectedHead,
    expectedShortHead: shortHead(expectedHead),
    appPath,
    executablePath,
    appStat: {
      mtimeMs: fs.statSync(appPath).mtimeMs,
      size: fs.statSync(appPath).size,
    },
    packageVersion: packageVersion(repoRoot),
    bundleInfo,
    installedAppTrustState,
    desktopProofState,
    protocolHandler,
    proofScope: {
      claim: 'mac-control-scoped installed app proof',
      supportDiagnostics: 'enabled-by-harness-for-native-companion-matrix',
      includedRows: proofPlan.map((entry) => entry.manifestRowId || entry.id),
      outOfScopeRows: [...MAC_CONTROL_OUT_OF_SCOPE_PARITY_ROWS],
    },
    screenshots,
    preflightAssertions,
    parityAssertions: screenshots.map((entry) => ({
      id: entry.id,
      manifestRowId: entry.manifestRowId,
      route: entry.route,
      artifactName: entry.artifactName,
      closeoutState: entry.closeoutState,
      settledMarkers: entry.settledMarkers,
      waitSelectors: entry.waitSelectors,
      status: entry.status,
    })),
    failure,
  };

  const files = writeReportFiles(artifactRoot, report);
  if (failure) {
    throw new Error(
      `Installed app proof failed during ${failure.stage} for ${failure.id}; wrote ${files.reportPath}: ${failure.message}`
    );
  }
  return { artifactRoot, report, files };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--allow-noncanonical-app-path') options.allowNonCanonicalAppPath = true;
    else if (arg === '--app') options.appPath = argv[++index];
    else if (arg === '--artifact-root') options.artifactRoot = argv[++index];
    else if (arg === '--repo-root') options.repoRoot = argv[++index];
    else if (arg === '--expected-head') options.expectedHead = argv[++index];
    else if (arg === '--timeout') options.timeout = Number(argv[++index]);
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function helpText() {
  return [
    'Usage: node scripts/evaosInstalledAppProductProof.js [--dry-run] [--app <path>] [--expected-head <sha>]',
    '',
    'Captures settled screenshots from /Applications/evaOS Workbench.app and fails if the About page',
    'does not show the expected current commit.',
    '',
    'Release proof must target the exact /Applications/evaOS Workbench.app path. Do not pass bundle ids.',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const repoHead = gitHead(repoRoot);
  const expectedHead = options.expectedHead || process.env.EVAOS_INSTALLED_APP_PROOF_EXPECTED_HEAD || repoHead;
  const appPath = options.appPath || DEFAULT_APP_PATH;
  const executablePath = installedExecutablePath(appPath);
  const artifactRoot = options.artifactRoot || artifactRootForHead(expectedHead, process.env);
  assertCanonicalProofAppPath(appPath, { allowNonCanonicalAppPath: options.allowNonCanonicalAppPath });

  if (options.dryRun) {
    const bundleInfo = fs.existsSync(appPath)
      ? readInfoPlist(appPath)
      : {
          bundleId: DEFAULT_BUNDLE_ID,
          bundleName: DEFAULT_EXECUTABLE_NAME,
          bundleVersion: packageVersion(repoRoot),
          shortVersion: packageVersion(repoRoot),
          protocolSchemes: [DEFAULT_PROTOCOL_SCHEME],
        };
    assertExpectedBundle(bundleInfo);
    const desktopProofState = inspectDesktopProofState(appPath);
    assertDesktopProofStateClean(desktopProofState);
    const installedAppTrustState = fs.existsSync(appPath)
      ? inspectInstalledAppTrustState(appPath)
      : {
          codesign: { ok: true, command: 'not checked', output: '' },
          spctl: { ok: true, command: 'not checked', output: '' },
          pythonCacheFiles: [],
        };
    assertInstalledAppTrustStateClean(installedAppTrustState);
    const plan = buildInstalledProofPlan(undefined, { expectedHead });
    const files = writeDryRunProofFiles({
      artifactRoot,
      repoHead,
      expectedHead,
      appPath,
      executablePath,
      bundleInfo,
      installedAppTrustState,
      desktopProofState,
      protocolHandler: {
        scheme: DEFAULT_PROTOCOL_SCHEME,
        bundleId: DEFAULT_BUNDLE_ID,
        evidence: `handlerpref id: ${DEFAULT_PROTOCOL_SCHEME}; all roles: ${DEFAULT_BUNDLE_ID}`,
        status: 'passed',
      },
      plan,
      packageVersion: packageVersion(repoRoot),
    });
    console.log(`[evaos-installed-app-proof] dry-run wrote ${files.reportPath}`);
    return;
  }

  const result = await captureInstalledAppProof({
    ...options,
    repoHead,
    expectedHead,
    appPath,
    executablePath,
    artifactRoot,
  });
  console.log(`[evaos-installed-app-proof] wrote ${result.files.reportPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[evaos-installed-app-proof] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_APP_PATH,
  DEFAULT_EXECUTABLE_NAME,
  DEFAULT_BUNDLE_ID,
  DEFAULT_PROTOCOL_SCHEME,
  BRIDGE_LAUNCH_AGENT_LABEL,
  LEXAR_CODEX_PREFIX,
  REPORT_SCHEMA,
  UNSAFE_PROOF_PATTERNS,
  artifactRootForHead,
  assertCanonicalProofAppPath,
  assertDesktopProofStateClean,
  assertInstalledAppTrustStateClean,
  assertMacBuildVersion,
  assertMacVersionString,
  assertNoUnsafeProofText,
  assertExpectedProtocolHandler,
  assertExpectedBundle,
  buildInstalledProofPlan,
  buildInstalledProofPreflightPlan,
  captureInstalledAppProof,
  gitHead,
  installedExecutablePath,
  inspectDesktopProofState,
  inspectInstalledAppTrustState,
  markdownForInstalledProof,
  packageVersion,
  parseAppBundlePaths,
  parsePlistArrayOutput,
  parseRunningWorkbenchProcesses,
  parseBridgeListenerPids,
  parseLaunchAgentBridgePath,
  parseLaunchAgentPid,
  parseLaunchServicesProtocolHandler,
  readIndexedWorkbenchApps,
  readLaunchAgentBridgeState,
  readLaunchServicesProtocolHandler,
  readRunningWorkbenchProcesses,
  readInfoPlist,
  runProofPlanAction,
  shortHead,
  writeDryRunProofFiles,
};
