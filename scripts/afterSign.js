const { execSync } = require('child_process');
const {
  assertPublicBetaNotarizationEnv,
  getEnvValue,
  isStrictPublicBetaReleaseEnv,
} = require('./evaosBetaReleaseGate');

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

  // Skip notarization if credentials are not provided
  if (
    !getEnvValue(process.env, { aliases: ['appleId', 'APPLE_ID'] }) ||
    !getEnvValue(process.env, { aliases: ['appleIdPassword', 'APPLE_ID_PASSWORD'] })
  ) {
    if (strictPublicBetaRelease) {
      assertPublicBetaNotarizationEnv(process.env);
    }
    console.log('Skipping notarization - missing Apple ID credentials');
    return;
  }

  if (strictPublicBetaRelease) {
    assertPublicBetaNotarizationEnv(process.env);
  }

  console.log(`Starting notarization for ${appName} (${appBundleId})...`);

  try {
    await notarize({
      tool: 'notarytool',
      appBundleId,
      appPath: appPath,
      appleId: getEnvValue(process.env, { aliases: ['appleId', 'APPLE_ID'] }),
      appleIdPassword: getEnvValue(process.env, { aliases: ['appleIdPassword', 'APPLE_ID_PASSWORD'] }),
      teamId: getEnvValue(process.env, { aliases: ['teamId', 'TEAM_ID'] }),
    });
    console.log('Notarization completed successfully');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};
