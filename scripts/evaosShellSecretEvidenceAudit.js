#!/usr/bin/env node

const fs = require('node:fs');

const REQUIRED_CATEGORIES = {
  console: [['renderer', 'console'], ['renderer', 'consoleLogs'], ['console'], ['consoleLogs']],
  localStorage: [['renderer', 'localStorage'], ['localStorage']],
  sessionStorage: [['renderer', 'sessionStorage'], ['sessionStorage']],
  urls: [['renderer', 'urls'], ['renderer', 'currentUrls'], ['urls'], ['currentUrls']],
  ipc: [['ipc', 'payloads'], ['ipc', 'messages'], ['ipcPayloads'], ['ipcMessages']],
};

const RAW_SECRET_PATTERNS = [
  { id: 'desktop-session-token', regex: /\beds_[A-Za-z0-9_-]{4,}\b/i },
  { id: 'provider-grant-token', regex: /\bepg_[A-Za-z0-9_-]{4,}\b/i },
  { id: 'bearer-token', regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/i },
  { id: 'openai-or-project-key', regex: /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/i },
  { id: 'github-token', regex: /\bgh[opusr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/i },
  { id: 'gitlab-token', regex: /\bglpat-[A-Za-z0-9_-]{10,}\b/i },
  { id: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{20,}\b/i },
  { id: 'aws-access-key', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i },
  { id: 'sendgrid-key', regex: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/ },
];

const SECRET_MARKER_PATTERNS = [
  { id: 'desktop-session-marker', regex: /desktop[_-]?session/i },
  { id: 'access-token-marker', regex: /access[_-]?token/i },
  { id: 'refresh-token-marker', regex: /refresh[_-]?token/i },
  { id: 'provider-grant-marker', regex: /provider[_-]?grant|grant[_-]?handle/i },
  { id: 'authorization-marker', regex: /\bauthorization\b/i },
  { id: 'password-marker', regex: /\bpassword\b/i },
  { id: 'api-key-marker', regex: /api[_-]?key/i },
  { id: 'client-secret-marker', regex: /client[_-]?secret|app[_-]?secret|secret[_-]?access[_-]?key/i },
  { id: 'service-role-marker', regex: /service[_-]?role/i },
];

const SECRET_PATTERNS = [...RAW_SECRET_PATTERNS, ...SECRET_MARKER_PATTERNS];

function hasPath(input, path) {
  let current = input;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return false;
    }
    current = current[segment];
  }
  return true;
}

function inspectCategories(input) {
  return Object.fromEntries(
    Object.entries(REQUIRED_CATEGORIES).map(([name, aliases]) => [name, aliases.some((path) => hasPath(input, path))])
  );
}

function patternMatches(value, patterns = SECRET_PATTERNS) {
  const text = String(value ?? '');
  return patterns.filter((pattern) => pattern.regex.test(text)).map((pattern) => pattern.id);
}

function sanitizePathSegment(segment) {
  const text = String(segment);
  return patternMatches(text, RAW_SECRET_PATTERNS).length > 0 ? '[redacted-key]' : text;
}

function formatPathSegment(segment) {
  if (typeof segment === 'number') return `[${segment}]`;
  const safe = sanitizePathSegment(segment);
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(safe) ? `.${safe}` : `[${JSON.stringify(safe)}]`;
}

function formatPath(segments) {
  return `$${segments.map(formatPathSegment).join('')}`;
}

function scanSecretEvidence(value, segments = [], findings = [], seen = new Set()) {
  if (typeof value === 'string') {
    for (const pattern of patternMatches(value)) {
      const path = formatPath(segments);
      const key = `${path}:${pattern}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({ path, pattern });
      }
    }
    return findings;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSecretEvidence(item, [...segments, index], findings, seen));
    return findings;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childSegments = [...segments, key];
      for (const pattern of patternMatches(key)) {
        const path = formatPath(childSegments);
        const findingKey = `${path}:${pattern}`;
        if (!seen.has(findingKey)) {
          seen.add(findingKey);
          findings.push({ path, pattern });
        }
      }
      scanSecretEvidence(child, childSegments, findings, seen);
    }
  }

  return findings;
}

function auditShellSecretEvidence(input) {
  const categories = inspectCategories(input);
  const findings = scanSecretEvidence(input);
  const blockers = [];

  for (const [category, present] of Object.entries(categories)) {
    if (!present) {
      blockers.push(`missing evidence category: ${category}`);
    }
  }

  for (const finding of findings) {
    blockers.push(`secret exposure detected at ${finding.path} (${finding.pattern})`);
  }

  return {
    schema: 'evaos-shell-secret-evidence-audit/v1',
    checkedAt: new Date().toISOString(),
    ready: blockers.length === 0,
    blockers,
    categories,
    findings,
  };
}

function renderMarkdown(report) {
  const lines = [
    '# evaOS Shell Secret Evidence Audit',
    '',
    `Checked: ${report.checkedAt}`,
    '',
    `Overall: ${report.ready ? 'ready' : 'blocked'}`,
    '',
    '## Evidence Categories',
    '',
  ];

  for (const [category, present] of Object.entries(report.categories)) {
    lines.push(`- ${category}: ${present ? 'present' : 'missing'}`);
  }

  if (report.findings.length > 0) {
    lines.push('', '## Secret Findings', '');
    for (const finding of report.findings) {
      lines.push(`- ${finding.path}: ${finding.pattern}`);
    }
  }

  if (report.blockers.length > 0) {
    lines.push('', '## Blockers', '');
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker}`);
    }
  }

  lines.push('', 'Note: findings intentionally omit raw evidence values.');
  return `${lines.join('\n').trim()}\n`;
}

function parseArgs(argv) {
  const options = {
    input: null,
    markdown: false,
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[(index += 1)];
    if (arg === '--markdown') options.markdown = true;
    if (arg === '--strict') options.strict = true;
  }

  return options;
}

function readInput(inputPath) {
  const text = inputPath ? fs.readFileSync(inputPath, 'utf8') : fs.readFileSync(0, 'utf8');
  return JSON.parse(text);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = auditShellSecretEvidence(readInput(options.input));

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
  REQUIRED_CATEGORIES,
  auditShellSecretEvidence,
  renderMarkdown,
  scanSecretEvidence,
};
