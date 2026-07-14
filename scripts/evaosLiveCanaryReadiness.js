#!/usr/bin/env node

const CANARIES = [
  {
    name: 'release-support-vm-target',
    command: 'node scripts/evaosMacControlDoctor.js',
    required: [
      'AIONUI_EVAOS_RELEASE_CANARY_ACCOUNT_EMAIL',
      'AIONUI_EVAOS_RELEASE_CANARY_CUSTOMER_ID',
      'AIONUI_EVAOS_RELEASE_CANARY_TARGET_KIND',
      'AIONUI_EVAOS_RELEASE_CANARY_TARGET_LABEL',
    ],
    exact: {
      AIONUI_EVAOS_RELEASE_CANARY_TARGET_KIND: 'customer_vm',
    },
    forbiddenValues: {
      AIONUI_EVAOS_RELEASE_CANARY_CUSTOMER_ID: ['golden', 'golden-vm', 'template', 'golden-template'],
      AIONUI_EVAOS_RELEASE_CANARY_TARGET_LABEL: ['Golden VM', 'Golden template', 'golden'],
    },
    optional: [
      'AIONUI_EVAOS_RELEASE_CANARY_CUSTOMER_LABEL',
      'AIONUI_EVAOS_RELEASE_CANARY_RUNTIME_OWNER',
      'EVAOS_MAC_CONTROL_DOCTOR_COMPUTER_USE_EVIDENCE',
    ],
  },
  {
    name: 'broker-runtime-status',
    command: 'node scripts/evaosBrokerLiveCanary.js',
    required: [],
    pairAlternatives: [
      {
        label: 'broker-specific',
        required: ['AIONUI_EVAOS_BROKER_CANARY_DESKTOP_SESSION', 'AIONUI_EVAOS_BROKER_CANARY_CUSTOMER_ID'],
      },
      {
        label: 'default',
        required: ['AIONUI_EVAOS_DESKTOP_SESSION', 'AIONUI_EVAOS_CUSTOMER_ID'],
      },
    ],
    requirePairWhenEnvTruthy: {
      env: 'AIONUI_EVAOS_REQUIRE_BROKER_CANARY_TARGET',
      label: 'broker-specific',
    },
    optional: ['AIONUI_EVAOS_BROKER_ENDPOINT', 'AIONUI_EVAOS_BROKER_RUNTIME'],
  },
  {
    name: 'selected-binding-mac-control',
    command: 'node scripts/evaosBrokerLiveCanary.js --mac-control',
    macControl: true,
    required: [
      'AIONUI_EVAOS_MAC_CONTROL_CANARY_ACK',
      'AIONUI_EVAOS_MAC_CONTROL_CANARY_DESKTOP_SESSION',
      'AIONUI_EVAOS_MAC_CONTROL_CANARY_CUSTOMER_ID',
      'AIONUI_EVAOS_MAC_CONTROL_CANARY_ENDPOINT',
      'AIONUI_EVAOS_MAC_CONTROL_CANARY_EXPECTED_CALLBACK_HOST',
    ],
    exact: {
      AIONUI_EVAOS_MAC_CONTROL_CANARY_ACK: 'evaos-mac-control-canary',
    },
    optional: [],
  },
  {
    name: 'trust-surface',
    command: 'node scripts/evaosTrustSurfaceLiveCanary.js',
    followUp: true,
    required: ['AIONUI_EVAOS_DESKTOP_SESSION', 'AIONUI_EVAOS_CUSTOMER_ID'],
    optional: ['AIONUI_EVAOS_BROKER_ENDPOINT'],
  },
  {
    name: 'provider-hub',
    command: 'node scripts/evaosProviderHubLiveCanary.js',
    followUp: true,
    required: ['AIONUI_EVAOS_DESKTOP_SESSION', 'AIONUI_EVAOS_CUSTOMER_ID'],
    optional: ['AIONUI_EVAOS_BROKER_ENDPOINT', 'AIONUI_EVAOS_PROVIDER_REQUIRED_STATES'],
  },
  {
    name: 'people-approval-deny',
    command: 'AIONUI_EVAOS_APPROVAL_DENY_ACK=evaos-deny-test node scripts/evaosPeopleApprovalLiveCanary.js',
    followUp: true,
    required: [
      'AIONUI_EVAOS_APPROVAL_DENY_ACK',
      'AIONUI_EVAOS_CUSTOMER_ID',
      'AIONUI_EVAOS_APPROVAL_ID',
      'AIONUI_EVAOS_REQUESTER_SESSION',
      'AIONUI_EVAOS_APPROVER_SESSION',
    ],
    exact: {
      AIONUI_EVAOS_APPROVAL_DENY_ACK: 'evaos-deny-test',
    },
    optional: [
      'AIONUI_EVAOS_BROKER_ENDPOINT',
      'AIONUI_EVAOS_REQUESTER_MEMBERSHIP_ID',
      'AIONUI_EVAOS_APPROVAL_DENY_REASON',
      'AIONUI_EVAOS_DENIED_SESSION',
    ],
  },
  {
    name: 'company-brain',
    command: 'node scripts/evaosCompanyBrainLiveCanary.js',
    followUp: true,
    required: [
      'AIONUI_EVAOS_DESKTOP_SESSION',
      'AIONUI_EVAOS_CUSTOMER_ID',
      'AIONUI_EVAOS_COMPANY_BRAIN_ACCOUNT_ID',
      'AIONUI_EVAOS_COMPANY_BRAIN_QUERY',
    ],
    anyOf: [['AIONUI_EVAOS_COMPANY_BRAIN_WRONG_CUSTOMER_ID', 'AIONUI_EVAOS_COMPANY_BRAIN_DENIED_SESSION']],
    optional: ['AIONUI_EVAOS_BROKER_ENDPOINT', 'AIONUI_EVAOS_COMPANY_BRAIN_REQUIRED_INGESTION_STATES'],
  },
  {
    name: 'business-browser',
    command:
      'AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK=evaos-browser-test node scripts/evaosBusinessBrowserLiveCanary.js',
    followUp: true,
    required: [
      'AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK',
      'AIONUI_EVAOS_DESKTOP_SESSION',
      'AIONUI_EVAOS_CUSTOMER_ID',
      'AIONUI_EVAOS_BUSINESS_BROWSER_TEST_URL',
      'AIONUI_EVAOS_BUSINESS_BROWSER_ALLOWED_HOSTS',
    ],
    exact: {
      AIONUI_EVAOS_BUSINESS_BROWSER_ACTION_ACK: 'evaos-browser-test',
    },
    anyOf: [['AIONUI_EVAOS_BUSINESS_BROWSER_WRONG_CUSTOMER_ID', 'AIONUI_EVAOS_BUSINESS_BROWSER_DENIED_SESSION']],
    optional: ['AIONUI_EVAOS_BROKER_ENDPOINT'],
  },
];

function hasEnv(env, name) {
  return typeof env[name] === 'string' && env[name].trim() !== '';
}

function truthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value || '')
      .trim()
      .toLowerCase()
  );
}

function includeFollowupCanaries(env) {
  if (!hasEnv(env, 'AIONUI_EVAOS_RUN_FOLLOWUP_CANARIES')) {
    return true;
  }
  return truthyEnv(env.AIONUI_EVAOS_RUN_FOLLOWUP_CANARIES);
}

function inspectCanary(canary, env) {
  const missingRequired = canary.required.filter((name) => !hasEnv(env, name));
  const invalidRequired = [];

  for (const [name, expected] of Object.entries(canary.exact ?? {})) {
    if (hasEnv(env, name) && env[name] !== expected) {
      invalidRequired.push(`${name} must equal ${expected}`);
    }
  }

  for (const [name, forbiddenValues] of Object.entries(canary.forbiddenValues ?? {})) {
    const value = hasEnv(env, name) ? String(env[name]).trim() : '';
    if (value && forbiddenValues.some((forbidden) => value.toLowerCase() === String(forbidden).toLowerCase())) {
      invalidRequired.push(`${name} must not be ${value}`);
    }
  }

  const missingAnyOf = [];
  for (const group of canary.anyOf ?? []) {
    if (!group.some((name) => hasEnv(env, name))) {
      missingAnyOf.push(group);
    }
  }

  const pairAlternatives = canary.pairAlternatives ?? [];
  const completePairAlternatives = [];
  const partialPairAlternatives = [];
  for (const alternative of pairAlternatives) {
    const present = alternative.required.filter((name) => hasEnv(env, name));
    if (present.length === alternative.required.length) {
      completePairAlternatives.push(alternative.label);
    } else if (present.length > 0) {
      partialPairAlternatives.push({
        label: alternative.label,
        missing: alternative.required.filter((name) => !hasEnv(env, name)),
      });
    }
  }
  const missingPairAlternatives =
    pairAlternatives.length > 0 && completePairAlternatives.length === 0 ? pairAlternatives : [];
  for (const partial of partialPairAlternatives) {
    invalidRequired.push(`${partial.label} credential pair is incomplete; missing ${partial.missing.join(', ')}`);
  }
  const requiredPair = canary.requirePairWhenEnvTruthy;
  if (requiredPair && truthyEnv(env[requiredPair.env]) && !completePairAlternatives.includes(requiredPair.label)) {
    invalidRequired.push(`${requiredPair.label} credential pair is required when ${requiredPair.env} is true`);
  }

  const presentOptional = (canary.optional ?? []).filter((name) => hasEnv(env, name));
  const ready =
    missingRequired.length === 0 &&
    invalidRequired.length === 0 &&
    missingAnyOf.length === 0 &&
    missingPairAlternatives.length === 0;

  return {
    name: canary.name,
    command: canary.command,
    ready,
    required: canary.required,
    anyOf: canary.anyOf ?? [],
    pairAlternatives,
    optional: canary.optional ?? [],
    missingRequired,
    invalidRequired,
    missingAnyOf,
    missingPairAlternatives,
    presentOptional,
  };
}

function blockerLines(canary) {
  const blockers = [];

  for (const name of canary.missingRequired) {
    blockers.push(`${canary.name}: missing ${name}`);
  }
  for (const invalid of canary.invalidRequired) {
    blockers.push(`${canary.name}: ${invalid}`);
  }
  for (const group of canary.missingAnyOf) {
    blockers.push(`${canary.name}: missing one of ${group.join(', ')}`);
  }
  if ((canary.missingPairAlternatives ?? []).length > 0) {
    const groups = canary.missingPairAlternatives.map(
      (alternative) => `${alternative.label} (${alternative.required.join(', ')})`
    );
    blockers.push(`${canary.name}: missing one complete credential pair: ${groups.join('; ')}`);
  }

  return blockers;
}

function inspectLiveCanaryReadiness(env = process.env) {
  const includeFollowups = includeFollowupCanaries(env);
  const includeMacControl = truthyEnv(env.AIONUI_EVAOS_RUN_MAC_CONTROL_CANARY);
  const canaries = CANARIES.filter(
    (canary) => (includeFollowups || canary.followUp !== true) && (includeMacControl || canary.macControl !== true)
  ).map((canary) => inspectCanary(canary, env));
  const blockers = canaries.flatMap(blockerLines);

  return {
    schema: 'evaos-live-canary-readiness/v1',
    checkedAt: new Date().toISOString(),
    followupCanariesIncluded: includeFollowups,
    macControlCanaryIncluded: includeMacControl,
    ready: blockers.length === 0,
    blockers,
    canaries,
  };
}

function renderMarkdown(report) {
  const lines = [
    '# evaOS Live Canary Readiness',
    '',
    `Checked: ${report.checkedAt}`,
    '',
    `Overall: ${report.ready ? 'ready' : 'blocked'}`,
    `Follow-up canaries included: ${report.followupCanariesIncluded ? 'yes' : 'no'}`,
    `Mac-control canary included: ${report.macControlCanaryIncluded ? 'yes' : 'no'}`,
    '',
  ];

  if (report.blockers.length > 0) {
    lines.push('## Blockers', '');
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker}`);
    }
    lines.push('');
  }

  lines.push('## Canaries', '');
  for (const canary of report.canaries) {
    lines.push(`### ${canary.name}`, '');
    lines.push(`- Status: ${canary.ready ? 'ready' : 'blocked'}`);
    lines.push(`- Command: \`${canary.command}\``);
    lines.push(`- Required: ${canary.required.map((name) => `\`${name}\``).join(', ')}`);
    if (canary.anyOf.length > 0) {
      const groups = canary.anyOf.map((group) => group.map((name) => `\`${name}\``).join(' or '));
      lines.push(`- Required one-of: ${groups.join('; ')}`);
    }
    if ((canary.pairAlternatives ?? []).length > 0) {
      const groups = canary.pairAlternatives.map(
        (alternative) => `${alternative.label}: ${alternative.required.map((name) => `\`${name}\``).join(' + ')}`
      );
      lines.push(`- Required credential pair: ${groups.join('; ')}`);
    }
    if (canary.optional.length > 0) {
      lines.push(`- Optional: ${canary.optional.map((name) => `\`${name}\``).join(', ')}`);
    }
    if (canary.missingRequired.length > 0) {
      lines.push(`- Missing required: ${canary.missingRequired.map((name) => `\`${name}\``).join(', ')}`);
    }
    if (canary.invalidRequired.length > 0) {
      lines.push(`- Invalid required: ${canary.invalidRequired.map((item) => `\`${item}\``).join(', ')}`);
    }
    if (canary.missingAnyOf.length > 0) {
      const groups = canary.missingAnyOf.map((group) => group.map((name) => `\`${name}\``).join(' or '));
      lines.push(`- Missing one-of: ${groups.join('; ')}`);
    }
    if ((canary.missingPairAlternatives ?? []).length > 0) {
      const groups = canary.missingPairAlternatives.map(
        (alternative) => `${alternative.label}: ${alternative.required.map((name) => `\`${name}\``).join(' + ')}`
      );
      lines.push(`- Missing credential pair: ${groups.join('; ')}`);
    }
    if (canary.presentOptional.length > 0) {
      lines.push(`- Optional present: ${canary.presentOptional.map((name) => `\`${name}\``).join(', ')}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

function parseArgs(argv) {
  return {
    markdown: argv.includes('--markdown'),
    strict: argv.includes('--strict'),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = inspectLiveCanaryReadiness(process.env);

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
  CANARIES,
  inspectLiveCanaryReadiness,
  renderMarkdown,
};
