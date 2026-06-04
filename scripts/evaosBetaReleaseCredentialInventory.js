#!/usr/bin/env node

const { execFileSync } = require('node:child_process');

const SIGNED_CANDIDATE_SECRETS = [
  {
    name: 'BUILD_CERTIFICATE_BASE64',
    reason: 'base64 encoded Developer ID certificate for signed macOS beta artifacts',
  },
  {
    name: 'P12_PASSWORD',
    reason: 'Developer ID certificate password for the imported signing certificate',
  },
  {
    name: 'IDENTITY',
    reason: 'Developer ID Application signing identity used by electron-builder',
  },
  {
    name: 'APPLE_ID',
    reason: 'Apple ID used for notarization',
  },
  {
    name: 'APPLE_ID_PASSWORD',
    reason: 'Apple app-specific password used for notarization',
  },
  {
    name: 'TEAM_ID',
    reason: 'Apple Developer Team ID used by notarytool',
  },
];

const DISTRIBUTION_SECRETS = [
  {
    name: 'GH_TOKEN',
    reason: 'PAT used by the manual beta release workflow for protected release/tag operations',
  },
  {
    name: 'AWS_REGION',
    reason: 'AWS region for public beta asset distribution',
  },
  {
    name: 'AWS_ROLE_ARN',
    reason: 'OIDC role used to upload public beta assets',
  },
  {
    name: 'AWS_S3_BUCKET',
    reason: 'destination bucket for public beta assets',
  },
];

const RELEASE_VARIABLES = [
  {
    name: 'EVAOS_BETA_RELEASE_BRANCH',
    reason: 'audited release branch allowed to own public beta tags',
  },
  {
    name: 'EVAOS_BETA_RELEASE_PUBLISH_ENABLED',
    reason: 'manual publish gate; keep disabled until issue #13 says ship public beta',
  },
];

function normalizeNames(values) {
  return new Set((values ?? []).map((value) => String(value ?? '').trim()).filter(Boolean));
}

function auditReleaseCredentialInventory(input) {
  const secrets = normalizeNames(input.secrets);
  const variables = normalizeNames(input.variables);
  const signingNames = SIGNED_CANDIDATE_SECRETS.map((entry) => entry.name);
  const distributionNames = DISTRIBUTION_SECRETS.map((entry) => entry.name);
  const variableNames = RELEASE_VARIABLES.map((entry) => entry.name);
  const allSecretNames = [...signingNames, ...distributionNames];

  const missingSecrets = allSecretNames.filter((name) => !secrets.has(name));
  const missingVariables = variableNames.filter((name) => !variables.has(name));
  const satisfiedSecrets = allSecretNames.filter((name) => secrets.has(name));
  const satisfiedVariables = variableNames.filter((name) => variables.has(name));
  const missingSignedCandidateSecrets = signingNames.filter((name) => !secrets.has(name));

  const readyForSignedCandidate = missingSignedCandidateSecrets.length === 0;
  const readyForDistribution = missingSecrets.length === 0 && missingVariables.length === 0;

  return {
    schema: 'evaos-beta-release-credential-inventory/v1',
    checkedAt: new Date().toISOString(),
    ready: readyForSignedCandidate && readyForDistribution,
    readyForSignedCandidate,
    readyForDistribution,
    missingSecrets,
    missingVariables,
    satisfiedSecrets,
    satisfiedVariables,
    secretCount: secrets.size,
    variableCount: variables.size,
  };
}

function renderMarkdown(report) {
  const lines = [
    '# evaOS Beta Release Credential Inventory',
    '',
    `Checked: ${report.checkedAt}`,
    '',
    `Overall: ${report.ready ? 'ready' : 'blocked'}`,
    `Signed candidate: ${report.readyForSignedCandidate ? 'ready' : 'blocked'}`,
    `Public distribution: ${report.readyForDistribution ? 'ready' : 'blocked'}`,
    '',
    `Repository secret names configured: ${report.secretCount}`,
    `Repository variable names configured: ${report.variableCount}`,
    '',
  ];

  if (report.missingSecrets.length > 0 || report.missingVariables.length > 0) {
    lines.push('## Missing Required Names', '');
    for (const name of report.missingSecrets) {
      lines.push(`- secret \`${name}\``);
    }
    for (const name of report.missingVariables) {
      lines.push(`- variable \`${name}\``);
    }
    lines.push('');
  }

  if (report.satisfiedSecrets.length > 0 || report.satisfiedVariables.length > 0) {
    lines.push('## Satisfied Names', '');
    for (const name of report.satisfiedSecrets) {
      lines.push(`- secret \`${name}\``);
    }
    for (const name of report.satisfiedVariables) {
      lines.push(`- variable \`${name}\``);
    }
    lines.push('');
  }

  lines.push('## Notes', '');
  lines.push('- This inventory is name-only and does not print secret values.');
  lines.push('- Keep `EVAOS_BETA_RELEASE_PUBLISH_ENABLED` disabled until issue #13 says `ship public beta`.');
  lines.push(
    '- Passing this inventory does not replace signed install, launch, updater/feed, rollback, and support proof.'
  );

  return `${lines.join('\n').trim()}\n`;
}

function ghJson(args) {
  const output = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(output || '[]');
}

function listGithubReleaseCredentialInventory(repo) {
  const secretRows = ghJson(['secret', 'list', '-R', repo, '--json', 'name']);
  const variableRows = ghJson(['variable', 'list', '-R', repo, '--json', 'name']);
  return {
    secrets: secretRows.map((row) => row.name),
    variables: variableRows.map((row) => row.name),
  };
}

function parseArgs(argv) {
  const options = {
    repo: process.env.GITHUB_REPOSITORY || '100yenadmin/AionUi',
    markdown: false,
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') options.repo = argv[(index += 1)];
    if (arg === '--markdown') options.markdown = true;
    if (arg === '--strict') options.strict = true;
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inventory = listGithubReleaseCredentialInventory(options.repo);
  const report = auditReleaseCredentialInventory(inventory);

  if (options.markdown) {
    process.stdout.write(renderMarkdown(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (options.strict && !report.ready) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DISTRIBUTION_SECRETS,
  RELEASE_VARIABLES,
  SIGNED_CANDIDATE_SECRETS,
  auditReleaseCredentialInventory,
  renderMarkdown,
};
