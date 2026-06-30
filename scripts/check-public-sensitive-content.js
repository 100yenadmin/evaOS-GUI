#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, statSync } = require('node:fs');

const MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024;
const personalAppleEmail = ['liangzhewei', 'gmail.com'].join('@');
const personalAppleTeamId = ['M4', 'AG47', 'ZV62'].join('');

const CONTENT_RULES = [
  {
    id: 'personal-apple-id',
    message: 'Hardcoded personal Apple account identifier must use environment-backed configuration.',
    test: (line) => line.includes(personalAppleEmail),
  },
  {
    id: 'personal-apple-team-id',
    message: 'Hardcoded Apple team identifier must use environment-backed configuration.',
    test: (line) => line.includes(personalAppleTeamId),
  },
  {
    id: 'private-key-material',
    message: 'Private key material must never be committed.',
    pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
  },
  {
    id: 'openai-api-key',
    message: 'Provider API keys must never be committed.',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: 'github-token',
    message: 'GitHub tokens must never be committed.',
    pattern: /\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  {
    id: 'google-api-key',
    message: 'Google API keys must never be committed.',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'aws-access-key',
    message: 'AWS access key identifiers must never be committed.',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'slack-token',
    message: 'Slack tokens must never be committed.',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    id: 'github-token-in-url',
    message: 'Credential-bearing GitHub URLs must be sanitized before logging or committing.',
    pattern: /https:\/\/x-access-token:(?!\$\{|\$\{\{)[^/@]{12,}@github\.com\//,
  },
  {
    id: 'test-fixture-secret',
    message: 'Secret-looking test fixtures must stay in approved test files only.',
    pattern: /\bsuper-secret-token\b/,
  },
];

const RISKY_FILE_PATH_PATTERN =
  /(^|\/)(\.env(\..*)?|.*\.(pem|p12|p8|key|mobileprovision|provisionprofile|sqlite|db|log)|id_rsa|id_ed25519|credentials?\.(json|ya?ml|toml|ini)|secrets?\.(json|ya?ml|toml|ini)|service-account.*\.json|GoogleService-Info\.plist|google-services\.json)$/i;

const ALLOWLIST = [
  {
    filePath: 'tests/unit/common/protocolDetector.test.ts',
    ruleIds: ['openai-api-key', 'google-api-key'],
  },
  {
    filePath: 'tests/unit/bootstrap/prepareEvaosDesktopBridgeResource.test.ts',
    ruleIds: ['test-fixture-secret', 'github-token-in-url'],
  },
];

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isAllowed(filePath, ruleId) {
  const normalized = normalizePath(filePath);
  return ALLOWLIST.some((entry) => entry.filePath === normalized && entry.ruleIds.includes(ruleId));
}

function makeFinding(filePath, line, rule) {
  return {
    filePath: normalizePath(filePath),
    line,
    ruleId: rule.id,
    message: rule.message,
    preview: `[REDACTED:${rule.id}]`,
  };
}

function scanPath(filePath) {
  const normalized = normalizePath(filePath);
  if (!RISKY_FILE_PATH_PATTERN.test(normalized)) {
    return [];
  }
  return [
    {
      filePath: normalized,
      ruleId: 'risky-tracked-file-name',
      message: 'Risky secret-bearing file name should not be tracked in a public repository.',
      preview: '[REDACTED:risky-tracked-file-name]',
    },
  ];
}

function scanText({ filePath, text }) {
  const findings = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const rule of CONTENT_RULES) {
      const matched = rule.test ? rule.test(line) : rule.pattern.test(line);
      if (matched && !isAllowed(filePath, rule.id)) {
        findings.push(makeFinding(filePath, index + 1, rule));
      }
    }
  });

  return findings;
}

function isProbablyTextBuffer(buffer) {
  if (buffer.includes(0)) {
    return false;
  }
  return true;
}

function trackedFiles(cwd) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd,
    encoding: 'buffer',
  });
  return output.toString('utf8').split('\0').filter(Boolean);
}

function scanRepository({ cwd = process.cwd() } = {}) {
  const findings = [];
  for (const filePath of trackedFiles(cwd)) {
    findings.push(...scanPath(filePath));

    const absolutePath = `${cwd}/${filePath}`;
    if (!existsSync(absolutePath)) {
      continue;
    }
    const stats = statSync(absolutePath);
    if (!stats.isFile() || stats.size > MAX_TEXT_FILE_BYTES) {
      continue;
    }

    const buffer = readFileSync(absolutePath);
    if (!isProbablyTextBuffer(buffer)) {
      continue;
    }
    findings.push(...scanText({ filePath, text: buffer.toString('utf8') }));
  }
  return findings;
}

function runCli() {
  const findings = scanRepository();
  if (findings.length === 0) {
    console.log('Public sensitive content check passed: no findings.');
    return;
  }

  console.error(`Public sensitive content check failed: ${findings.length} finding(s).`);
  for (const finding of findings.slice(0, 200)) {
    const location = finding.line ? `${finding.filePath}:${finding.line}` : finding.filePath;
    console.error(`${location} ${finding.ruleId} ${finding.message} ${finding.preview}`);
  }
  if (findings.length > 200) {
    console.error(`... ${findings.length - 200} additional finding(s) omitted.`);
  }
  process.exit(1);
}

if (require.main === module) {
  runCli();
}

module.exports = {
  scanPath,
  scanRepository,
  scanText,
};
