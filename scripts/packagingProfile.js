const VALID_PACKAGING_PROFILES = new Set(['full', 'functional-smoke', 'thin-shell']);
const DEFAULT_PACKAGING_PROFILE = 'full';

const RELEASE_ENV_FLAGS = [
  'EVAOS_FINALIZE_MAC_DMG',
  'EVAOS_DMG_CODESIGN',
  'EVAOS_BETA_RELEASE_ACK',
  'EVAOS_BETA_DISTRIBUTION_ACK',
  'EVAOS_BETA_LOCAL_SIGNED_DMG_FALLBACK_ACK',
  'EVAOS_BETA_TRUSTED_MANIFEST_PATH',
  'EVAOS_BETA_RELEASE_PROVENANCE_MODE',
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_NAME',
  'APPLE_ID',
  'APPLE_ID_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_API_KEY_PATH',
  'APPLE_TEAM_ID',
  'NOTARYTOOL_PROFILE',
];

function isTruthyEnvValue(value) {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return (
    normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'no' && normalized !== 'off'
  );
}

function normalizePackagingProfile(value) {
  const profile = String(value || DEFAULT_PACKAGING_PROFILE).trim();
  if (!VALID_PACKAGING_PROFILES.has(profile)) {
    throw new Error(
      `Invalid Workbench packaging profile "${profile}". Expected one of: ${[...VALID_PACKAGING_PROFILES].join(', ')}`
    );
  }
  return profile;
}

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

function getTruthyReleaseFlags(env = process.env) {
  return RELEASE_ENV_FLAGS.filter((name) => isTruthyEnvValue(env[name]));
}

function assertThinShellNotRelease(profile, { env = process.env, context = 'build' } = {}) {
  if (profile !== 'thin-shell') return;

  const releaseFlags = getTruthyReleaseFlags(env);
  if (releaseFlags.length === 0) return;

  throw new Error(
    [
      `EVAOS_PACKAGING_PROFILE=thin-shell is UI-shell proof only and cannot be used for ${context}.`,
      `Refusing because release/signing/notary flag(s) are set: ${releaseFlags.join(', ')}.`,
      'Use EVAOS_PACKAGING_PROFILE=full for release proof or functional-smoke for full-resource smoke proof.',
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
