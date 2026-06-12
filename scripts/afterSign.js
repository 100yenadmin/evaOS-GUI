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

function runTrustCommand(label, command, args, runCommand = execFileSync) {
  try {
    runCommand(command, args, { stdio: 'inherit' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`);
  }
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

async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Lazy-load notarize because @electron/notarize is ESM-only
  const { notarize } = await import('@electron/notarize');

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
    await withKeychainCredentialIsolation(notarizationOptions, () => notarize(notarizationOptions));
    stapleAndValidateApp(appPath);
    console.log('Notarization, app stapling, and Gatekeeper validation completed successfully');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
}

module.exports = afterSign;
module.exports.default = afterSign;
module.exports.getNotarizationOptions = getNotarizationOptions;
module.exports.stapleAndValidateApp = stapleAndValidateApp;
module.exports.withKeychainCredentialIsolation = withKeychainCredentialIsolation;
