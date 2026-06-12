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
  aliases: ['EVAOS_DMG_CODESIGN_KEYCHAIN', 'RELEASE_KEYCHAIN', 'NOTARY_KEYCHAIN', 'KEYCHAIN'],
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

function buildNotarytoolSubmitArgs(dmgPath, env = process.env) {
  const apiKey = getEnvValue(env, API_KEY_ENV);
  const apiKeyId = getEnvValue(env, API_KEY_ID_ENV);
  const apiIssuer = getEnvValue(env, API_ISSUER_ENV);
  if (apiKey || apiKeyId || apiIssuer) {
    if (!apiKey || !apiKeyId || !apiIssuer) {
      throw new Error(
        'App Store Connect API-key DMG notarization requires APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER.'
      );
    }
    return ['notarytool', 'submit', dmgPath, '--key', apiKey, '--key-id', apiKeyId, '--issuer', apiIssuer];
  }

  const keychainProfile = getEnvValue(env, KEYCHAIN_PROFILE_ENV);
  if (keychainProfile) {
    const args = ['notarytool', 'submit', dmgPath, '--keychain-profile', keychainProfile];
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
    const args = ['notarytool', 'submit', dmgPath, '--apple-id', appleId, '--password', applePassword];
    if (teamId) {
      args.push('--team-id', teamId);
    }
    return args;
  }

  return [];
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

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
}

function runNotarytoolSubmit(submitArgs, env = process.env) {
  const timeoutMs = getNotaryProcessTimeoutMs(env);
  try {
    run('xcrun', submitArgs, { timeout: timeoutMs });
  } catch (error) {
    const timedOut =
      error &&
      (error.code === 'ETIMEDOUT' ||
        error.signal === 'SIGTERM' ||
        String(error.message || '').toLowerCase().includes('timed out'));
    if (timedOut) {
      throw new Error(
        `notarytool submit timed out after ${timeoutMs}ms; check for hidden keychain prompts, credential-mode drift, or Apple notarization stalls.`
      );
    }
    throw error;
  }
}

function finalizeDmg(dmgPath, env = process.env) {
  const identity = getEnvValue(env, SIGNING_IDENTITY_ENV);
  if (!identity) {
    throw new Error(
      'evaOS DMG finalization requires EVAOS_DMG_CODESIGN_IDENTITY, IDENTITY_SHA, identity, or CSC_NAME.'
    );
  }

  assertPublicBetaNotarizationEnv(env);

  const signArgs = ['--force', '--sign', identity, '--timestamp'];
  const signingKeychain = getEnvValue(env, SIGNING_KEYCHAIN_ENV);
  if (signingKeychain) {
    signArgs.push('--keychain', signingKeychain);
  }
  signArgs.push(dmgPath);
  run('codesign', signArgs);
  run('codesign', ['--verify', '--verbose=2', dmgPath]);

  const submitArgs = buildNotarytoolSubmitArgs(dmgPath, env);
  if (submitArgs.length === 0) {
    throw new Error('evaOS DMG finalization could not build notarytool submit arguments.');
  }
  submitArgs.push(
    '--wait',
    '--timeout',
    env.EVAOS_DMG_NOTARY_TIMEOUT || '15m',
    '--no-progress',
    '--output-format',
    'json'
  );
  runNotarytoolSubmit(submitArgs, env);
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
  buildNotarytoolSubmitArgs,
  finalizeMacDmgs,
  findDmgArtifacts,
  getNotaryProcessTimeoutMs,
};
