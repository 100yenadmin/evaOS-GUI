#!/usr/bin/env node

const { execFileSync } = require('node:child_process');

const REQUIRED_SINGLE_FIXTURES = [
  {
    name: 'AIONUI_EVAOS_DESKTOP_SESSION',
    kind: 'secret',
    reason: 'desktop session for broker, trust-surface, provider, Company Brain, and Business Browser canaries',
  },
  {
    name: 'AIONUI_EVAOS_CUSTOMER_ID',
    kind: 'variable-or-secret',
    reason: 'staging customer ID shared across live canaries',
  },
  {
    name: 'AIONUI_EVAOS_APPROVAL_ID',
    kind: 'variable-or-secret',
    reason: 'staging approval request to deny',
  },
  {
    name: 'AIONUI_EVAOS_REQUESTER_SESSION',
    kind: 'secret',
    reason: 'requester session for deny-loop proof',
  },
  {
    name: 'AIONUI_EVAOS_APPROVER_SESSION',
    kind: 'secret',
    reason: 'approver session for deny-loop proof',
  },
  {
    name: 'AIONUI_EVAOS_COMPANY_BRAIN_ACCOUNT_ID',
    kind: 'variable-or-secret',
    reason: 'Company Brain account 360 fixture',
  },
  {
    name: 'AIONUI_EVAOS_COMPANY_BRAIN_QUERY',
    kind: 'variable-or-secret',
    reason: 'Company Brain query fixture',
  },
  {
    name: 'AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL',
    kind: 'variable-or-secret',
    reason: 'safe staging URL for browser launch proof',
  },
  {
    name: 'AIONUI_EVAOS_BUSINESS_BROWSER_ALLOWED_HOSTS',
    kind: 'variable-or-secret',
    reason: 'allowlist for the staging browser URL host',
  },
];

const RECOMMENDED_VARIABLES = [
  'AIONUI_EVAOS_RUNTIME',
  'AIONUI_EVAOS_PROVIDER_REQUIRED_STATES',
  'AIONUI_EVAOS_APPROVAL_DENY_REASON',
];

const RECOMMENDED_VARIABLE_DEFAULTS = {
  AIONUI_EVAOS_RUNTIME: 'browser',
  AIONUI_EVAOS_PROVIDER_REQUIRED_STATES: 'connected,needs_login,expired,revoked,approval_required',
  AIONUI_EVAOS_APPROVAL_DENY_REASON: 'evaOS beta deny-loop canary',
};

const REQUIRED_ONE_OF_FIXTURES = [
  {
    names: ['AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID', 'AIONUI_EVAOS_COMPANY_BRAIN_DENIED_SESSION'],
    reason: 'Company Brain cross-org or denied-session negative proof',
  },
  {
    names: ['AIONUI_EVAOS_BUSINESS_BROWSER_WRONG_CUSTOMER_ID', 'AIONUI_EVAOS_BUSINESS_BROWSER_DENIED_SESSION'],
    reason: 'Business Browser wrong-customer or denied-session negative proof',
  },
];

function normalizeNames(values) {
  return new Set((values ?? []).map((value) => String(value ?? '').trim()).filter(Boolean));
}

function hasName(inventory, name) {
  return inventory.secrets.has(name) || inventory.variables.has(name);
}

function auditEnvironmentInventory(input) {
  const inventory = {
    secrets: normalizeNames(input.secrets),
    variables: normalizeNames(input.variables),
  };
  const missing = [];
  const satisfied = [];

  for (const fixture of REQUIRED_SINGLE_FIXTURES) {
    const ok = fixture.kind === 'secret' ? inventory.secrets.has(fixture.name) : hasName(inventory, fixture.name);
    if (ok) {
      satisfied.push(fixture.name);
    } else {
      missing.push(fixture.name);
    }
  }

  const missingOneOf = [];
  const satisfiedOneOf = [];
  for (const group of REQUIRED_ONE_OF_FIXTURES) {
    if (group.names.some((name) => hasName(inventory, name))) {
      satisfiedOneOf.push(group.names);
    } else {
      missingOneOf.push(group.names);
    }
  }

  const recommendedPresent = RECOMMENDED_VARIABLES.filter((name) => inventory.variables.has(name));
  const recommendedMissing = RECOMMENDED_VARIABLES.filter((name) => !inventory.variables.has(name));

  return {
    schema: 'evaos-live-canary-github-env-inventory/v1',
    checkedAt: new Date().toISOString(),
    ready: missing.length === 0 && missingOneOf.length === 0,
    missing,
    missingOneOf,
    satisfied,
    satisfiedOneOf,
    recommendedPresent,
    recommendedMissing,
    secretCount: inventory.secrets.size,
    variableCount: inventory.variables.size,
  };
}

function renderMarkdown(report) {
  const lines = [
    '# evaOS Live Canary GitHub Environment Inventory',
    '',
    `Checked: ${report.checkedAt}`,
    '',
    `Overall: ${report.ready ? 'ready' : 'blocked'}`,
    '',
    `Secret names configured: ${report.secretCount}`,
    `Variable names configured: ${report.variableCount}`,
    '',
  ];

  if (report.missing.length > 0 || report.missingOneOf.length > 0) {
    lines.push('## Missing Required Fixtures', '');
    for (const name of report.missing) {
      lines.push(`- \`${name}\``);
    }
    for (const group of report.missingOneOf) {
      lines.push(`- one of ${group.map((name) => `\`${name}\``).join(' or ')}`);
    }
    lines.push('');
  }

  if (report.satisfied.length > 0 || report.satisfiedOneOf.length > 0) {
    lines.push('## Satisfied Fixtures', '');
    for (const name of report.satisfied) {
      lines.push(`- \`${name}\``);
    }
    for (const group of report.satisfiedOneOf) {
      lines.push(`- one-of satisfied: ${group.map((name) => `\`${name}\``).join(' or ')}`);
    }
    lines.push('');
  }

  lines.push('## Recommended Non-Secret Defaults', '');
  if (report.recommendedPresent.length > 0) {
    lines.push(`- Present: ${report.recommendedPresent.map((name) => `\`${name}\``).join(', ')}`);
  }
  if (report.recommendedMissing.length > 0) {
    lines.push(`- Missing: ${report.recommendedMissing.map((name) => `\`${name}\``).join(', ')}`);
  }

  return `${lines.join('\n').trim()}\n`;
}

function valuePlaceholder(name) {
  return `<replace-${String(name).toLowerCase().replaceAll('_', '-')}>`;
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function secretCommand(name, repo, environment) {
  return `gh secret set ${name} -R ${shellArg(repo)} --env ${shellArg(environment)}`;
}

function variableCommand(name, repo, environment, value = valuePlaceholder(name)) {
  return `gh variable set ${name} -R ${shellArg(repo)} --env ${shellArg(environment)} --body ${shellArg(value)}`;
}

function commandForFixture(fixture, repo, environment) {
  if (fixture.kind === 'secret') {
    return secretCommand(fixture.name, repo, environment);
  }
  return variableCommand(fixture.name, repo, environment);
}

function renderProvisioningTemplate(options = {}) {
  const repo = options.repo || '100yenadmin/AionUi';
  const environment = options.environment || 'evaos-staging';
  const branch = options.branch || 'evaos/dev';
  const proofRef = options.proofRef || 'https://github.com/100yenadmin/AionUi/issues/41';
  const lines = [
    '# evaOS Live Canary Fixture Provisioning Template',
    '',
    'This template is name-only and placeholder-only. Do not paste real secret values into GitHub comments, docs, session notes, screenshots, or packet files.',
    '',
    '## Required Secrets',
    '',
  ];

  for (const fixture of REQUIRED_SINGLE_FIXTURES.filter((entry) => entry.kind === 'secret')) {
    lines.push(`# ${fixture.reason}`);
    lines.push(commandForFixture(fixture, repo, environment));
    lines.push('');
  }

  lines.push('## Required Variables Or Secret-Backed Values', '');
  for (const fixture of REQUIRED_SINGLE_FIXTURES.filter((entry) => entry.kind !== 'secret')) {
    lines.push(`# ${fixture.reason}`);
    lines.push(commandForFixture(fixture, repo, environment));
    lines.push(`# If this value is sensitive, store it as a secret instead:`);
    lines.push(secretCommand(fixture.name, repo, environment));
    lines.push('');
  }

  lines.push('## Required One-Of Negative Fixtures', '');
  for (const group of REQUIRED_ONE_OF_FIXTURES) {
    lines.push(`# ${group.reason}`);
    for (const name of group.names) {
      if (name.endsWith('_DENIED_SESSION')) {
        lines.push(secretCommand(name, repo, environment));
      } else {
        lines.push(variableCommand(name, repo, environment));
        lines.push(`# If ${name} is sensitive, store it as a secret instead:`);
        lines.push(secretCommand(name, repo, environment));
      }
    }
    lines.push('');
  }

  lines.push('## Recommended Non-Secret Defaults', '');
  for (const name of RECOMMENDED_VARIABLES) {
    lines.push(variableCommand(name, repo, environment, RECOMMENDED_VARIABLE_DEFAULTS[name] || valuePlaceholder(name)));
  }

  lines.push(
    '',
    '## Verify Inventory',
    '',
    `node scripts/evaosLiveCanaryEnvInventory.js --repo ${shellArg(repo)} --env ${shellArg(environment)} --strict --markdown`,
    '',
    '## Dispatch Live Canary Proof',
    '',
    [
      `gh workflow run evaos-live-canary-proof.yml -R ${shellArg(repo)}`,
      `--ref ${shellArg(branch)}`,
      '-f live_canary_ack=evaos-live-canary',
      '-f run_live_canaries=true',
      `-f proof_ref=${shellArg(proofRef)}`,
    ].join(' ')
  );

  return `${lines.join('\n').trim()}\n`;
}

function ghJson(args) {
  const output = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(output || '[]');
}

function listGithubEnvironmentInventory(repo, environment) {
  const secretRows = ghJson(['secret', 'list', '-R', repo, '--env', environment, '--json', 'name']);
  const variableRows = ghJson(['variable', 'list', '-R', repo, '--env', environment, '--json', 'name']);
  return {
    secrets: secretRows.map((row) => row.name),
    variables: variableRows.map((row) => row.name),
  };
}

function parseArgs(argv) {
  const options = {
    repo: process.env.GITHUB_REPOSITORY || '100yenadmin/AionUi',
    environment: 'evaos-staging',
    markdown: false,
    strict: false,
    provisioningTemplate: false,
    branch: 'evaos/dev',
    proofRef: 'https://github.com/100yenadmin/AionUi/issues/41',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') options.repo = argv[(index += 1)];
    if (arg === '--env' || arg === '--environment') options.environment = argv[(index += 1)];
    if (arg === '--markdown') options.markdown = true;
    if (arg === '--strict') options.strict = true;
    if (arg === '--provisioning-template') options.provisioningTemplate = true;
    if (arg === '--branch') options.branch = argv[(index += 1)];
    if (arg === '--proof-ref') options.proofRef = argv[(index += 1)];
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.provisioningTemplate) {
    process.stdout.write(
      renderProvisioningTemplate({
        repo: options.repo,
        environment: options.environment,
        branch: options.branch,
        proofRef: options.proofRef,
      })
    );
    return;
  }

  const inventory = listGithubEnvironmentInventory(options.repo, options.environment);
  const report = auditEnvironmentInventory(inventory);

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
  REQUIRED_ONE_OF_FIXTURES,
  REQUIRED_SINGLE_FIXTURES,
  auditEnvironmentInventory,
  listGithubEnvironmentInventory,
  renderMarkdown,
  renderProvisioningTemplate,
};
