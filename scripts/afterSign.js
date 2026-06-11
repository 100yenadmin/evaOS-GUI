const { execSync } = require('child_process');
const {
  assertPublicBetaNotarizationEnv,
  getEnvValue,
  isStrictPublicBetaReleaseEnv,
  normalizeBoolean,
} = require('./evaosBetaReleaseGate');

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
  const individualApiKey = normalizeBoolean(
    getEnvValue(env, { aliases: ['APPLE_API_INDIVIDUAL_KEY', 'appleApiIndividualKey'] })
  );

  if (!appleApiKey || !appleApiKeyId) {
    return undefined;
  }

  const options = {
    appleApiKey,
    appleApiKeyId,
  };

  if (!individualApiKey && appleApiIssuer) {
    options.appleApiIssuer = appleApiIssuer;
  }

  return options;
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
  const keychainOptions = getKeychainNotarizationOptions(env);
  if (keychainOptions) {
    return { ...baseOptions, ...keychainOptions };
  }

  const appleIdOptions = getAppleIdNotarizationOptions(env);
  if (appleIdOptions) {
    return { ...baseOptions, ...appleIdOptions };
  }

  const apiKeyOptions = getApiKeyNotarizationOptions(env);
  if (apiKeyOptions) {
    return { ...baseOptions, ...apiKeyOptions };
  }

  return undefined;
}

exports.default = async function afterSign(context) {
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
    await notarize(notarizationOptions);
    console.log('Notarization completed successfully');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};

exports.getNotarizationOptions = getNotarizationOptions;
