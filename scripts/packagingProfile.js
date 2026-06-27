const VALID_PACKAGING_PROFILES = new Set(['full', 'functional-smoke', 'thin-shell']);
const DEFAULT_PACKAGING_PROFILE = 'full';

const RELEASE_ENV_FLAGS = [
  'EVAOS_FINALIZE_MAC_DMG',
  'EVAOS_DMG_CODESIGN',
  'EVAOS_BETA_PUBLIC_RELEASE',
  'EVAOS_BETA_REQUIRE_SIGNING',
  'EVAOS_BETA_RELEASE_ACK',
  'EVAOS_BETA_DISTRIBUTION_ACK',
  'EVAOS_BETA_LOCAL_SIGNED_DMG_FALLBACK_ACK',
  'EVAOS_BETA_TRUSTED_MANIFEST_PATH',
  'EVAOS_BETA_RELEASE_PROVENANCE_MODE',
  'BUILD_CERTIFICATE_BASE64',
  'P12_PASSWORD',
  'identity',
  'IDENTITY',
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_NAME',
  'CSC_IDENTITY_AUTO_DISCOVERY',
  'appleId',
  'APPLE_ID',
  'appleIdPassword',
  'APPLE_ID_PASSWORD',
  'appleApiKey',
  'APPLE_API_KEY',
  'appleApiKeyId',
  'APPLE_API_KEY_ID',
  'appleApiIssuer',
  'APPLE_API_ISSUER',
  'APPLE_API_KEY_PATH',
  'APPLE_API_INDIVIDUAL_KEY',
  'appleApiIndividualKey',
  'teamId',
  'TEAM_ID',
  'APPLE_TEAM_ID',
  'NOTARY_PROFILE',
  'KEYCHAIN_PROFILE',
  'keychainProfile',
  'NOTARYTOOL_PROFILE',
];

/**
 * Checks whether an environment-style value is explicitly enabled.
 *
 * @param {unknown} value - Value to normalize from process.env or a test env object.
 * @returns {boolean} True for non-empty values except common false tokens.
 */
function isTruthyEnvValue(value) {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return (
    normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'no' && normalized !== 'off'
  );
}

/**
 * Normalizes a Workbench packaging profile.
 *
 * @param {unknown} value - Candidate profile from CLI or EVAOS_PACKAGING_PROFILE.
 * @returns {string} A validated packaging profile.
 * @throws {Error} When the value is not one of the supported profiles.
 */
function normalizePackagingProfile(value) {
  const profile = String(value || DEFAULT_PACKAGING_PROFILE).trim();
  if (!VALID_PACKAGING_PROFILES.has(profile)) {
    throw new Error(
      `Invalid Workbench packaging profile "${profile}". Expected one of: ${[...VALID_PACKAGING_PROFILES].join(', ')}`
    );
  }
  return profile;
}

/**
 * Reads the active Workbench packaging profile.
 *
 * CLI arguments take precedence over EVAOS_PACKAGING_PROFILE so one-off smoke
 * commands can override ambient CI env, and both sources default to full.
 *
 * @param {{argv?: string[], env?: NodeJS.ProcessEnv|Record<string, string|undefined>}} [options] - Args/env to inspect.
 * @returns {string} The validated packaging profile.
 * @throws {Error} When the selected profile is unsupported.
 */
function readPackagingProfile({ argv = process.argv.slice(2), env = process.env } = {}) {
  let cliProfile = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--packaging-profile=')) {
      cliProfile = arg.slice('--packaging-profile='.length);
      continue;
    }
    if (arg === '--packaging-profile') {
      cliProfile = argv[index + 1] || '';
      index += 1;
    }
  }

  return normalizePackagingProfile(cliProfile || env.EVAOS_PACKAGING_PROFILE || DEFAULT_PACKAGING_PROFILE);
}

/**
 * Removes Workbench packaging-profile flags before forwarding args to electron-builder.
 *
 * @param {string[]} argv - Command line args passed to build-with-builder.
 * @returns {string[]} Args with --packaging-profile removed.
 */
function stripPackagingProfileArgs(argv) {
  const stripped = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--packaging-profile=')) continue;
    if (arg === '--packaging-profile') {
      index += 1;
      continue;
    }
    stripped.push(arg);
  }
  return stripped;
}

/**
 * Lists release, signing, notary, or distribution env flags that are currently enabled.
 *
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} [env=process.env] - Env object to inspect.
 * @returns {string[]} Names of enabled release-only env flags.
 */
function getTruthyReleaseFlags(env = process.env) {
  return RELEASE_ENV_FLAGS.filter((name) => isTruthyEnvValue(env[name]));
}

/**
 * Prevents non-full packaging profiles from being used as release proof.
 *
 * `thin-shell` and `functional-smoke` are smoke-only profiles. They may run
 * unsigned unpacked-app checks, but any signing, notary, finalization, or
 * release-publication flag means the caller must use the default `full` profile.
 *
 * @param {string} profile - Validated Workbench packaging profile.
 * @param {{env?: NodeJS.ProcessEnv|Record<string, string|undefined>, context?: string}} [options] - Env and caller label.
 * @throws {Error} When a non-full profile is combined with release-only flags.
 */
function assertThinShellNotRelease(profile, { env = process.env, context = 'build' } = {}) {
  if (profile === 'full') return;

  const releaseFlags = getTruthyReleaseFlags(env);
  if (releaseFlags.length === 0) return;

  throw new Error(
    [
      `EVAOS_PACKAGING_PROFILE=${profile} is smoke proof only and cannot be used for ${context}.`,
      `Refusing because release/signing/notary flag(s) are set: ${releaseFlags.join(', ')}.`,
      'Use EVAOS_PACKAGING_PROFILE=full for release proof.',
    ].join(' ')
  );
}

module.exports = {
  DEFAULT_PACKAGING_PROFILE,
  VALID_PACKAGING_PROFILES,
  RELEASE_ENV_FLAGS,
  assertThinShellNotRelease,
  getTruthyReleaseFlags,
  isTruthyEnvValue,
  normalizePackagingProfile,
  readPackagingProfile,
  stripPackagingProfileArgs,
};
