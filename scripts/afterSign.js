const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const {
  assertPublicBetaNotarizationEnv,
  getEnvValue,
  isStrictPublicBetaReleaseEnv,
} = require('./evaosBetaReleaseGate');

const AMBIENT_APPLE_API_ENV_KEYS = [
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_API_INDIVIDUAL_KEY',
  'appleApiKey',
  'appleApiKeyId',
  'appleApiIssuer',
  'appleApiIndividualKey',
];
const DEFAULT_APP_NOTARY_PROCESS_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_APP_NOTARY_COMMAND_PROCESS_TIMEOUT_MS = 90 * 1000;
const DEFAULT_APP_NOTARY_POLL_INTERVAL_MS = 15 * 1000;
const DEFAULT_APP_TRUST_PROCESS_TIMEOUT_MS = 5 * 60 * 1000;

function getAppleIdNotarizationOptions(env) {
  const appleId = getEnvValue(env, { aliases: ['appleId', 'APPLE_ID'] });
  const appleIdPassword = getEnvValue(env, { aliases: ['appleIdPassword', 'APPLE_ID_PASSWORD'] });
  const teamId = getEnvValue(env, { aliases: ['teamId', 'TEAM_ID'] });

  if (!appleId || !appleIdPassword) {
    return undefined;
  }

  return {
    appleId,
    appleIdPassword,
    teamId,
  };
}

function getApiKeyNotarizationOptions(env) {
  const appleApiKey = getEnvValue(env, { aliases: ['appleApiKey', 'APPLE_API_KEY'] });
  const appleApiKeyId = getEnvValue(env, { aliases: ['appleApiKeyId', 'APPLE_API_KEY_ID'] });
  const appleApiIssuer = getEnvValue(env, { aliases: ['appleApiIssuer', 'APPLE_API_ISSUER'] });

  if (!appleApiKey || !appleApiKeyId || !appleApiIssuer) {
    return undefined;
  }

  return {
    appleApiKey,
    appleApiKeyId,
    appleApiIssuer,
  };
}

function getKeychainNotarizationOptions(env) {
  const keychainProfile = getEnvValue(env, { aliases: ['keychainProfile', 'KEYCHAIN_PROFILE', 'NOTARY_PROFILE'] });
  const keychain = getEnvValue(env, { aliases: ['keychain', 'KEYCHAIN', 'NOTARY_KEYCHAIN', 'RELEASE_KEYCHAIN'] });

  if (!keychainProfile) {
    return undefined;
  }

  const options = {
    keychainProfile,
  };

  if (keychain) {
    options.keychain = keychain;
  }

  return options;
}

function getNotarizationOptions(env, baseOptions) {
  const apiKeyOptions = getApiKeyNotarizationOptions(env);
  if (apiKeyOptions) {
    return { ...baseOptions, ...apiKeyOptions };
  }

  const appleIdOptions = getAppleIdNotarizationOptions(env);
  if (appleIdOptions) {
    return { ...baseOptions, ...appleIdOptions };
  }

  const keychainOptions = getKeychainNotarizationOptions(env);
  if (keychainOptions) {
    return { ...baseOptions, ...keychainOptions };
  }

  return undefined;
}

async function withKeychainCredentialIsolation(notarizationOptions, operation) {
  if (!notarizationOptions || !notarizationOptions.keychainProfile) {
    return operation();
  }

  const previousValues = new Map();
  for (const key of AMBIENT_APPLE_API_ENV_KEYS) {
    previousValues.set(key, {
      exists: Object.prototype.hasOwnProperty.call(process.env, key),
      value: process.env[key],
    });
    delete process.env[key];
  }

  try {
    return await operation();
  } finally {
    for (const [key, previous] of previousValues.entries()) {
      if (previous.exists && typeof previous.value === 'string') {
        process.env[key] = previous.value;
      } else {
        delete process.env[key];
      }
    }
  }
}

function getPositiveProcessTimeoutMs(env, envKey, defaultMs) {
  const rawTimeout = env[envKey];
  if (!rawTimeout) {
    return defaultMs;
  }

  const timeoutMs = Number.parseInt(rawTimeout, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${envKey} must be a positive integer, got: ${rawTimeout}`);
  }
  return timeoutMs;
}

function getAppNotaryProcessTimeoutMs(env = process.env) {
  return getPositiveProcessTimeoutMs(env, 'EVAOS_APP_NOTARY_PROCESS_TIMEOUT_MS', DEFAULT_APP_NOTARY_PROCESS_TIMEOUT_MS);
}

function getAppNotaryCommandProcessTimeoutMs(env = process.env) {
  return getPositiveProcessTimeoutMs(
    env,
    'EVAOS_APP_NOTARY_COMMAND_PROCESS_TIMEOUT_MS',
    DEFAULT_APP_NOTARY_COMMAND_PROCESS_TIMEOUT_MS
  );
}

function getAppNotaryPollIntervalMs(env = process.env) {
  return getPositiveProcessTimeoutMs(env, 'EVAOS_APP_NOTARY_POLL_INTERVAL_MS', DEFAULT_APP_NOTARY_POLL_INTERVAL_MS);
}

function getAppTrustProcessTimeoutMs(env = process.env) {
  return getPositiveProcessTimeoutMs(env, 'EVAOS_APP_TRUST_PROCESS_TIMEOUT_MS', DEFAULT_APP_TRUST_PROCESS_TIMEOUT_MS);
}

function isProcessTimeoutError(error) {
  return (
    error &&
    (error.code === 'ETIMEDOUT' ||
      error.signal === 'SIGTERM' ||
      String(error.message || '')
        .toLowerCase()
        .includes('timed out'))
  );
}

function runTrustCommand(label, command, args, runCommand = execFileSync, options = {}, env = process.env) {
  const timeoutMs = getAppTrustProcessTimeoutMs(env);
  try {
    runCommand(command, args, { stdio: 'inherit', timeout: timeoutMs, ...options });
  } catch (error) {
    if (isProcessTimeoutError(error)) {
      throw new Error(
        `${label} timed out after ${timeoutMs}ms; check for hidden prompts, trust-policy stalls, or a wedged macOS trust command.`
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`);
  }
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

function runNotarytoolJson(label, args, env = process.env, runCommand = execFileSync) {
  const timeoutMs = getAppNotaryCommandProcessTimeoutMs(env);
  try {
    const output = runCommand('xcrun', args, {
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
      timeout: timeoutMs,
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

function buildAppNotarytoolSubmitArgs(archivePath, notarizationOptions) {
  if (notarizationOptions.appleApiKey || notarizationOptions.appleApiKeyId || notarizationOptions.appleApiIssuer) {
    if (!notarizationOptions.appleApiKey || !notarizationOptions.appleApiKeyId || !notarizationOptions.appleApiIssuer) {
      throw new Error(
        'App Store Connect API-key app notarization requires APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER.'
      );
    }
    return [
      'notarytool',
      'submit',
      archivePath,
      '--key',
      notarizationOptions.appleApiKey,
      '--key-id',
      notarizationOptions.appleApiKeyId,
      '--issuer',
      notarizationOptions.appleApiIssuer,
    ];
  }

  if (notarizationOptions.appleId || notarizationOptions.appleIdPassword || notarizationOptions.teamId) {
    if (!notarizationOptions.appleId || !notarizationOptions.appleIdPassword || !notarizationOptions.teamId) {
      throw new Error('Apple ID app notarization requires APPLE_ID, APPLE_ID_PASSWORD, and TEAM_ID.');
    }
    return [
      'notarytool',
      'submit',
      archivePath,
      '--apple-id',
      notarizationOptions.appleId,
      '--password',
      notarizationOptions.appleIdPassword,
      '--team-id',
      notarizationOptions.teamId,
    ];
  }

  if (notarizationOptions.keychainProfile) {
    const args = ['notarytool', 'submit', archivePath, '--keychain-profile', notarizationOptions.keychainProfile];
    if (notarizationOptions.keychain) {
      args.push('--keychain', notarizationOptions.keychain);
    }
    return args;
  }

  throw new Error('No app notarization credential mode was provided.');
}

function buildAppNotarytoolInfoArgs(submissionId, notarizationOptions) {
  if (notarizationOptions.appleApiKey || notarizationOptions.appleApiKeyId || notarizationOptions.appleApiIssuer) {
    if (!notarizationOptions.appleApiKey || !notarizationOptions.appleApiKeyId || !notarizationOptions.appleApiIssuer) {
      throw new Error(
        'App Store Connect API-key app notarization requires APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER.'
      );
    }
    return [
      'notarytool',
      'info',
      submissionId,
      '--key',
      notarizationOptions.appleApiKey,
      '--key-id',
      notarizationOptions.appleApiKeyId,
      '--issuer',
      notarizationOptions.appleApiIssuer,
    ];
  }

  if (notarizationOptions.appleId || notarizationOptions.appleIdPassword || notarizationOptions.teamId) {
    if (!notarizationOptions.appleId || !notarizationOptions.appleIdPassword || !notarizationOptions.teamId) {
      throw new Error('Apple ID app notarization requires APPLE_ID, APPLE_ID_PASSWORD, and TEAM_ID.');
    }
    return [
      'notarytool',
      'info',
      submissionId,
      '--apple-id',
      notarizationOptions.appleId,
      '--password',
      notarizationOptions.appleIdPassword,
      '--team-id',
      notarizationOptions.teamId,
    ];
  }

  if (notarizationOptions.keychainProfile) {
    const args = ['notarytool', 'info', submissionId, '--keychain-profile', notarizationOptions.keychainProfile];
    if (notarizationOptions.keychain) {
      args.push('--keychain', notarizationOptions.keychain);
    }
    return args;
  }

  throw new Error('No app notarization credential mode was provided.');
}

function runAppNotarytoolSubmit(submitArgs, env = process.env, runCommand = execFileSync) {
  const response = runNotarytoolJson(
    'app notarytool submit',
    [...submitArgs, '--no-progress', '--output-format', 'json'],
    env,
    runCommand
  );
  const submissionId = response.id || response.submissionId;
  if (!submissionId) {
    throw new Error(`app notarytool submit did not return a submission id: ${JSON.stringify(response)}`);
  }
  return submissionId;
}

function waitForAppNotarySubmission(
  submissionId,
  notarizationOptions,
  env = process.env,
  runCommand = execFileSync,
  sleep = sleepSync
) {
  const timeoutMs = getAppNotaryProcessTimeoutMs(env);
  const pollIntervalMs = getAppNotaryPollIntervalMs(env);
  const startedAt = Date.now();
  let lastStatus = 'unknown';

  while (Date.now() - startedAt <= timeoutMs) {
    const infoArgs = [...buildAppNotarytoolInfoArgs(submissionId, notarizationOptions), '--output-format', 'json'];
    const info = runNotarytoolJson(`app notarytool info ${submissionId}`, infoArgs, env, runCommand);
    lastStatus = String(info.status || info.Status || 'unknown').toLowerCase();

    if (lastStatus === 'accepted') {
      return info;
    }

    if (lastStatus === 'invalid' || lastStatus === 'rejected') {
      throw new Error(`app notarization ${submissionId} failed with status ${info.status}: ${JSON.stringify(info)}`);
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      break;
    }
    sleep(Math.min(pollIntervalMs, timeoutMs - elapsedMs));
  }

  throw new Error(
    `app notarization polling timed out after ${timeoutMs}ms for ${submissionId}; last status: ${lastStatus}`
  );
}

function stapleAndValidateApp(appPath, runCommand = execFileSync) {
  runTrustCommand('App stapling', 'xcrun', ['stapler', 'staple', appPath], runCommand);
  runTrustCommand('App stapler validation', 'xcrun', ['stapler', 'validate', appPath], runCommand);
  runTrustCommand(
    'App Gatekeeper execute assessment',
    'spctl',
    ['--assess', '--type', 'execute', '--verbose', appPath],
    runCommand
  );
}

function notarizeAndStapleApp(appPath, notarizationOptions, env = process.env, runCommand = execFileSync) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-app-notary-'));
  try {
    const archivePath = path.join(tempDir, `${path.basename(appPath, '.app')}.zip`);
    runTrustCommand(
      'App notarization archive',
      'ditto',
      ['-c', '-k', '--sequesterRsrc', '--keepParent', path.basename(appPath), archivePath],
      runCommand,
      { cwd: path.dirname(appPath) },
      env
    );

    const submitArgs = buildAppNotarytoolSubmitArgs(archivePath, notarizationOptions);
    const submissionId = runAppNotarytoolSubmit(submitArgs, env, runCommand);
    console.log(`Submitted app notarization ${submissionId}; polling notarytool info until terminal status.`);
    waitForAppNotarySubmission(submissionId, notarizationOptions, env, runCommand);
    stapleAndValidateApp(appPath, runCommand);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }
  const appName = context.packager.appInfo.productFilename;
  const appBundleId = context.packager.appInfo.id;
  const appPath = `${appOutDir}/${appName}.app`;
  // Strict mode is controlled by EVAOS_BETA_PUBLIC_RELEASE / EVAOS_BETA_REQUIRE_SIGNING.
  const strictPublicBetaRelease = isStrictPublicBetaReleaseEnv(process.env);

  // Check if app is actually signed before attempting notarization
  try {
    execSync(`codesign --verify --verbose "${appPath}"`, { stdio: 'pipe' });
    console.log(`App ${appName} is properly code signed`);
  } catch (error) {
    if (strictPublicBetaRelease) {
      throw new Error(`Ad-hoc signing is not allowed for evaOS public beta release: ${appName}`);
    }
    console.log(`App ${appName} is not code signed, applying ad-hoc signature...`);
    try {
      execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
      console.log(`Ad-hoc signature applied successfully to ${appName}`);
    } catch (adHocError) {
      console.error('Ad-hoc signing failed:', adHocError.message);
    }
    return;
  }

  const notarizationOptions = getNotarizationOptions(process.env, {
    tool: 'notarytool',
    appBundleId,
    appPath: appPath,
  });

  // Skip notarization if credentials are not provided
  if (!notarizationOptions) {
    if (strictPublicBetaRelease) {
      assertPublicBetaNotarizationEnv(process.env);
    }
    console.log('Skipping notarization - missing notarization credentials');
    return;
  }

  if (strictPublicBetaRelease) {
    assertPublicBetaNotarizationEnv(process.env);
  }

  console.log(`Starting notarization for ${appName} (${appBundleId})...`);

  try {
    await withKeychainCredentialIsolation(notarizationOptions, () =>
      notarizeAndStapleApp(appPath, notarizationOptions, process.env)
    );
    console.log('Notarization, app stapling, and Gatekeeper validation completed successfully');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
}

module.exports = afterSign;
module.exports.default = afterSign;
module.exports.buildAppNotarytoolInfoArgs = buildAppNotarytoolInfoArgs;
module.exports.buildAppNotarytoolSubmitArgs = buildAppNotarytoolSubmitArgs;
module.exports.getAppNotaryCommandProcessTimeoutMs = getAppNotaryCommandProcessTimeoutMs;
module.exports.getAppNotaryPollIntervalMs = getAppNotaryPollIntervalMs;
module.exports.getAppNotaryProcessTimeoutMs = getAppNotaryProcessTimeoutMs;
module.exports.getAppTrustProcessTimeoutMs = getAppTrustProcessTimeoutMs;
module.exports.getNotarizationOptions = getNotarizationOptions;
module.exports.runAppNotarytoolSubmit = runAppNotarytoolSubmit;
module.exports.notarizeAndStapleApp = notarizeAndStapleApp;
module.exports.stapleAndValidateApp = stapleAndValidateApp;
module.exports.waitForAppNotarySubmission = waitForAppNotarySubmission;
module.exports.withKeychainCredentialIsolation = withKeychainCredentialIsolation;
