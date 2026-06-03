#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ISSUE_TEMPLATE_PATH = '.github/ISSUE_TEMPLATE/evaos_agent_handoff.yml';
const PR_TEMPLATE_PATH = '.github/pull_request_template.md';

const REQUIRED_HANDOFF_FIELD_IDS = [
  'owner',
  'source_repos',
  'systems_touched',
  'modules_files',
  'contracts',
  'dependencies',
  'non_goals',
  'mutation_boundary',
  'proof_path',
  'rollback',
  'confidence_gate',
];

const REQUIRED_PR_HANDOFF_FIELDS = [
  'Source repos:',
  'Systems touched:',
  'Modules/files:',
  'Contracts:',
  'Dependencies:',
  'Non-goals:',
  'Mutation boundary:',
  'Proof path:',
  'Rollback:',
  'Confidence gate:',
];

const REQUIRED_PACKET_FILES = ['decision.md', 'proof.md', 'negative-proof.md', 'takeover.md'];

const REQUIRED_PACKET_MARKERS = {
  'decision.md': [/decision/i, /recommendation|confidence/i],
  'proof.md': [/proof/i, /primitive canary|scenario canary|ci|validation/i],
  'negative-proof.md': [/negative/i, /deny|denial|expired|revoked|wrong-customer|fail/i],
  'takeover.md': [/takeover/i, /branch|next safe action|known blocker|files/i],
};

function readFile(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function collectRepoHandoffIssues(rootDir = process.cwd()) {
  const issues = [];

  let issueTemplate = '';
  try {
    issueTemplate = readFile(rootDir, ISSUE_TEMPLATE_PATH);
  } catch {
    issues.push(`${ISSUE_TEMPLATE_PATH}: missing evaOS agent handoff issue template`);
  }

  if (issueTemplate) {
    if (!issueTemplate.includes('ready-for-agent')) {
      issues.push(`${ISSUE_TEMPLATE_PATH}: template must apply ready-for-agent label`);
    }
    for (const fieldId of REQUIRED_HANDOFF_FIELD_IDS) {
      if (!new RegExp(`\\bid:\\s*${fieldId}\\b`).test(issueTemplate)) {
        issues.push(`${ISSUE_TEMPLATE_PATH}: missing required field id ${fieldId}`);
      }
    }
  }

  let prTemplate = '';
  try {
    prTemplate = readFile(rootDir, PR_TEMPLATE_PATH);
  } catch {
    issues.push(`${PR_TEMPLATE_PATH}: missing pull request template`);
  }

  if (prTemplate) {
    if (!prTemplate.includes('## Agent Handoff')) {
      issues.push(`${PR_TEMPLATE_PATH}: missing Agent Handoff section`);
    }
    for (const field of REQUIRED_PR_HANDOFF_FIELDS) {
      if (!prTemplate.includes(field)) {
        issues.push(`${PR_TEMPLATE_PATH}: missing handoff field "${field}"`);
      }
    }
  }

  return issues;
}

function isIssuePacketDirectory(entry) {
  return entry.isDirectory() && /^\d{2,}-[a-z0-9][a-z0-9-]*$/.test(entry.name);
}

function collectPacketIssues(packetRoot) {
  const issues = [];
  if (!packetRoot) {
    issues.push('packet root is required');
    return issues;
  }
  if (!fs.existsSync(packetRoot)) {
    issues.push(`${packetRoot}: packet root does not exist`);
    return issues;
  }

  const packetDirs = fs.readdirSync(packetRoot, { withFileTypes: true }).filter(isIssuePacketDirectory);
  if (packetDirs.length === 0) {
    issues.push(`${packetRoot}: no issue packet directories found`);
    return issues;
  }

  for (const entry of packetDirs) {
    const dir = path.join(packetRoot, entry.name);
    for (const requiredFile of REQUIRED_PACKET_FILES) {
      const filePath = path.join(dir, requiredFile);
      if (!fs.existsSync(filePath)) {
        issues.push(`${entry.name}: missing ${requiredFile}`);
        continue;
      }

      const text = fs.readFileSync(filePath, 'utf8').trim();
      if (!text) {
        issues.push(`${entry.name}/${requiredFile}: file is empty`);
        continue;
      }

      for (const marker of REQUIRED_PACKET_MARKERS[requiredFile]) {
        if (!marker.test(text)) {
          issues.push(`${entry.name}/${requiredFile}: missing marker ${marker}`);
        }
      }
    }

    const artifactDir = path.join(dir, 'artifacts');
    if (!fs.existsSync(artifactDir) || !fs.statSync(artifactDir).isDirectory()) {
      issues.push(`${entry.name}: missing artifacts/ directory`);
    }
  }

  return issues;
}

function printIssues(title, issues) {
  if (issues.length === 0) {
    console.log(`${title} passed.`);
    return;
  }

  console.error(`${title} failed:`);
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
}

function main(argv = process.argv.slice(2)) {
  const [command, packetRoot] = argv;

  if (!command || command === 'audit-repo') {
    const issues = collectRepoHandoffIssues(process.cwd());
    printIssues('evaOS repo handoff audit', issues);
    process.exit(issues.length > 0 ? 1 : 0);
  }

  if (command === 'audit-packets') {
    const issues = collectPacketIssues(packetRoot);
    printIssues('evaOS sprint packet audit', issues);
    process.exit(issues.length > 0 ? 1 : 0);
  }

  console.error('Usage: node scripts/evaosSprintPacketAudit.js [audit-repo|audit-packets <packet-root>]');
  process.exit(2);
}

if (require.main === module) {
  main();
}

module.exports = {
  ISSUE_TEMPLATE_PATH,
  PR_TEMPLATE_PATH,
  REQUIRED_HANDOFF_FIELD_IDS,
  REQUIRED_PACKET_FILES,
  collectPacketIssues,
  collectRepoHandoffIssues,
};
