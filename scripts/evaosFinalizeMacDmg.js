#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  assertPublicBetaNotarizationEnv,
  getEnvValue,
  isStrictPublicBetaReleaseEnv,
} = require('./evaosBetaReleaseGate');

const SIGNING_IDENTITY_ENV = {
  aliases: ['EVAOS_DMG_CODESIGN_IDENTITY', 'IDENTITY_SHA', 'CODESIGN_IDENTITY', 'identity', 'CSC_NAME'],
};
const SIGNING_KEYCHAIN_ENV = {
  aliases: ['EVAOS_DMG_CODESIGN_KEYCHAIN', 'CODESIGN_KEYCHAIN'],
};
const KEYCHAIN_PROFILE_ENV = {
  aliases: ['NOTARY_PROFILE', 'KEYCHAIN_PROFILE', 'keychainProfile'],
};
const NOTARY_KEYCHAIN_ENV = {
  aliases: ['NOTARY_KEYCHAIN', 'RELEASE_KEYCHAIN', 'KEYCHAIN', 'keychain'],
};
const APPLE_ID_ENV = {
  aliases: ['appleId', 'APPLE_ID'],
};
const APPLE_PASSWORD_ENV = {
  aliases: ['appleIdPassword', 'APPLE_ID_PASSWORD'],
};
const TEAM_ID_ENV = {
  aliases: ['teamId', 'TEAM_ID'],
};
const API_KEY_ENV = {
  aliases: ['appleApiKey', 'APPLE_API_KEY'],
};
const API_KEY_ID_ENV = {
  aliases: ['appleApiKeyId', 'APPLE_API_KEY_ID'],
};
const API_ISSUER_ENV = {
  aliases: ['appleApiIssuer', 'APPLE_API_ISSUER'],
};
const DEFAULT_NOTARY_PROCESS_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_NOTARY_COMMAND_PROCESS_TIMEOUT_MS = 90 * 1000;
const DEFAULT_NOTARY_POLL_INTERVAL_MS = 15 * 1000;
const DEFAULT_DMG_TRUST_PROCESS_TIMEOUT_MS = 5 * 60 * 1000;

function findDmgArtifacts(outDir) {
  if (!fs.existsSync(outDir)) {
    return [];
  }

  return fs
    .readdirSync(outDir)
    .filter((entry) => entry.endsWith('.dmg'))
    .sort()
    .map((entry) => path.join(outDir, entry));
}

function buildNotarytoolCredentialArgs(env = process.env) {
  const apiKey = getEnvValue(env, API_KEY_ENV);
  const apiKeyId = getEnvValue(env, API_KEY_ID_ENV);
  const apiIssuer = getEnvValue(env, API_ISSUER_ENV);
  if (apiKey || apiKeyId || apiIssuer) {
    if (!apiKey || !apiKeyId || !apiIssuer) {
      throw new Error(
        'App Store Connect API-key DMG notarization requires APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER.'
      );
    }
    return ['--key', apiKey, '--key-id', apiKeyId, '--issuer', apiIssuer];
  }

  const keychainProfile = getEnvValue(env, KEYCHAIN_PROFILE_ENV);
  if (keychainProfile) {
    const args = ['--keychain-profile', keychainProfile];
    const keychain = getEnvValue(env, NOTARY_KEYCHAIN_ENV);
    if (keychain) {
      args.push('--keychain', keychain);
    }
    return args;
  }

  const appleId = getEnvValue(env, APPLE_ID_ENV);
  const applePassword = getEnvValue(env, APPLE_PASSWORD_ENV);
  const teamId = getEnvValue(env, TEAM_ID_ENV);
  if (appleId && applePassword) {
    const args = ['--apple-id', appleId, '--password', applePassword];
    if (teamId) {
      args.push('--team-id', teamId);
    }
    return args;
  }

  return [];
}

function buildNotarytoolSubmitArgs(dmgPath, env = process.env) {
  const credentialArgs = buildNotarytoolCredentialArgs(env);
  return credentialArgs.length === 0 ? [] : ['notarytool', 'submit', dmgPath, ...credentialArgs];
}

function buildNotarytoolInfoArgs(submissionId, env = process.env) {
  const credentialArgs = buildNotarytoolCredentialArgs(env);
  return credentialArgs.length === 0 ? [] : ['notarytool', 'info', submissionId, ...credentialArgs];
}

function getNotaryProcessTimeoutMs(env = process.env) {
  const rawTimeout = env.EVAOS_DMG_NOTARY_PROCESS_TIMEOUT_MS;
  if (!rawTimeout) {
    return DEFAULT_NOTARY_PROCESS_TIMEOUT_MS;
  }

  const timeoutMs = Number.parseInt(rawTimeout, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`EVAOS_DMG_NOTARY_PROCESS_TIMEOUT_MS must be a positive integer, got: ${rawTimeout}`);
  }
  return timeoutMs;
}

function getNotaryCommandProcessTimeoutMs(env = process.env) {
  const rawTimeout = env.EVAOS_DMG_NOTARY_COMMAND_PROCESS_TIMEOUT_MS;
  if (!rawTimeout) {
    return DEFAULT_NOTARY_COMMAND_PROCESS_TIMEOUT_MS;
  }

  const timeoutMs = Number.parseInt(rawTimeout, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`EVAOS_DMG_NOTARY_COMMAND_PROCESS_TIMEOUT_MS must be a positive integer, got: ${rawTimeout}`);
  }
  return timeoutMs;
}

function getNotaryPollIntervalMs(env = process.env) {
  const rawTimeout = env.EVAOS_DMG_NOTARY_POLL_INTERVAL_MS;
  if (!rawTimeout) {
    return DEFAULT_NOTARY_POLL_INTERVAL_MS;
  }

  const timeoutMs = Number.parseInt(rawTimeout, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`EVAOS_DMG_NOTARY_POLL_INTERVAL_MS must be a positive integer, got: ${rawTimeout}`);
  }
  return timeoutMs;
}

function parseNotarytoolJson(label, output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output || '');
  try {
    return JSON.parse(text);
  } catch (error) {
    const summary = text.replace(/\s+/g, ' ').trim().slice(0, 500);
    throw new Error(`${label} did not return valid JSON${summary ? `: ${summary}` : ''}`);
  }
}

function isProcessTimeoutError(error) {
  return (
    error &&
    (error.code === 'ETIMEDOUT' ||
      error.signal === 'SIGTERM' ||
      error.signal === 'SIGKILL' ||
      String(error.message || '')
        .toLowerCase()
        .includes('timed out'))
  );
}

function getDmgTrustProcessTimeoutMs(env = process.env) {
  const rawTimeout = env.EVAOS_DMG_TRUST_PROCESS_TIMEOUT_MS;
  if (!rawTimeout) {
    return DEFAULT_DMG_TRUST_PROCESS_TIMEOUT_MS;
  }

  const timeoutMs = Number.parseInt(rawTimeout, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`EVAOS_DMG_TRUST_PROCESS_TIMEOUT_MS must be a positive integer, got: ${rawTimeout}`);
  }
  return timeoutMs;
}

function run(command, args, options = {}, env = process.env) {
  const timeoutMs = getDmgTrustProcessTimeoutMs(env);
  try {
    execFileSync(command, args, {
      stdio: 'inherit',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      ...options,
    });
  } catch (error) {
    if (isProcessTimeoutError(error)) {
      throw new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms.`);
    }
    throw error;
  }
}

function runNotarytoolJson(label, args, env = process.env) {
  const timeoutMs = getNotaryCommandProcessTimeoutMs(env);
  try {
    const output = execFileSync('xcrun', args, {
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    return parseNotarytoolJson(label, output);
  } catch (error) {
    if (isProcessTimeoutError(error)) {
      throw new Error(
        `${label} timed out after ${timeoutMs}ms; check for hidden prompts or Apple notarization stalls.`
      );
    }
    throw error;
  }
}

function sleepSync(ms) {
  if (ms <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runNotarytoolSubmit(submitArgs, env = process.env) {
  const response = runNotarytoolJson(
    'DMG notarytool submit',
    [...submitArgs, '--no-progress', '--output-format', 'json'],
    env
  );
  const submissionId = response.id || response.submissionId;
  if (!submissionId) {
    throw new Error(`DMG notarytool submit did not return a submission id: ${JSON.stringify(response)}`);
  }
  return submissionId;
}

function waitForNotarySubmission(submissionId, env = process.env, sleep = sleepSync) {
  const timeoutMs = getNotaryProcessTimeoutMs(env);
  const pollIntervalMs = getNotaryPollIntervalMs(env);
  const startedAt = Date.now();
  let lastStatus = 'unknown';

  while (Date.now() - startedAt <= timeoutMs) {
    const infoArgs = [...buildNotarytoolInfoArgs(submissionId, env), '--output-format', 'json'];
    if (infoArgs.length === 2) {
      throw new Error('evaOS DMG finalization could not build notarytool info arguments.');
    }
    const info = runNotarytoolJson(`DMG notarytool info ${submissionId}`, infoArgs, env);
    lastStatus = String(info.status || info.Status || 'unknown').toLowerCase();

    if (lastStatus === 'accepted') {
      return info;
    }

    if (lastStatus === 'invalid' || lastStatus === 'rejected') {
      throw new Error(`DMG notarization ${submissionId} failed with status ${info.status}: ${JSON.stringify(info)}`);
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      break;
    }
    sleep(Math.min(pollIntervalMs, timeoutMs - elapsedMs));
  }

  throw new Error(
    `DMG notarization polling timed out after ${timeoutMs}ms for ${submissionId}; last status: ${lastStatus}`
  );
}

function buildDmgCodesignArgs(dmgPath, identity, env = process.env) {
  const signArgs = ['--force', '--sign', identity, '--timestamp'];
  // Do not reuse NOTARY_KEYCHAIN here. It may only contain a notarytool profile,
  // while codesign must use the Developer ID signing keychain or default search list.
  const signingKeychain = getEnvValue(env, SIGNING_KEYCHAIN_ENV);
  if (signingKeychain) {
    signArgs.push('--keychain', signingKeychain);
  }
  signArgs.push(dmgPath);
  return signArgs;
}

function finalizeDmg(dmgPath, env = process.env) {
  const identity = getEnvValue(env, SIGNING_IDENTITY_ENV);
  if (!identity) {
    throw new Error(
      'evaOS DMG finalization requires EVAOS_DMG_CODESIGN_IDENTITY, IDENTITY_SHA, identity, or CSC_NAME.'
    );
  }

  assertPublicBetaNotarizationEnv(env);

  run('codesign', buildDmgCodesignArgs(dmgPath, identity, env));
  run('codesign', ['--verify', '--verbose=2', dmgPath]);

  const submitArgs = buildNotarytoolSubmitArgs(dmgPath, env);
  if (submitArgs.length === 0) {
    throw new Error('evaOS DMG finalization could not build notarytool submit arguments.');
  }
  const submissionId = runNotarytoolSubmit(submitArgs, env);
  console.log(`Submitted DMG notarization ${submissionId}; polling notarytool info until terminal status.`);
  waitForNotarySubmission(submissionId, env);
  run('xcrun', ['stapler', 'staple', dmgPath]);
  run('xcrun', ['stapler', 'validate', dmgPath]);
  run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose', dmgPath]);
}

function finalizeMacDmgs({ outDir = path.resolve(__dirname, '../out'), env = process.env } = {}) {
  if (process.platform !== 'darwin') {
    return [];
  }

  const strict = isStrictPublicBetaReleaseEnv(env);
  if (!strict && env.EVAOS_FINALIZE_MAC_DMG !== 'true') {
    return [];
  }

  const dmgPaths = findDmgArtifacts(outDir);
  if (dmgPaths.length === 0) {
    throw new Error(`No macOS DMG artifacts found in ${outDir}`);
  }

  for (const dmgPath of dmgPaths) {
    console.log(`📀 Finalizing evaOS DMG: ${path.basename(dmgPath)}`);
    finalizeDmg(dmgPath, env);
  }

  return dmgPaths;
}

function main() {
  const outDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../out');
  const finalized = finalizeMacDmgs({ outDir, env: process.env });
  if (finalized.length === 0) {
    console.log('No evaOS DMGs finalized; strict release mode is not enabled.');
  } else {
    console.log(`Finalized ${finalized.length} evaOS DMG artifact(s).`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  buildDmgCodesignArgs,
  buildNotarytoolInfoArgs,
  buildNotarytoolSubmitArgs,
  finalizeMacDmgs,
  findDmgArtifacts,
  getDmgTrustProcessTimeoutMs,
  getNotaryCommandProcessTimeoutMs,
  getNotaryPollIntervalMs,
  getNotaryProcessTimeoutMs,
  runNotarytoolSubmit,
  waitForNotarySubmission,
};
