#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const TRUST_SURFACE_FILES = [
  'packages/desktop/src/renderer/pages/people-access/index.tsx',
  'packages/desktop/src/renderer/pages/approval-center/index.tsx',
  'packages/desktop/src/renderer/pages/connected-apps/index.tsx',
  'packages/desktop/src/renderer/pages/business-browser/index.tsx',
  'packages/desktop/src/renderer/pages/company-brain/index.tsx',
];

const SHARED_SAFE_TEXT_HELPER = 'packages/desktop/src/renderer/utils/evaosSafeText.ts';
const BROKER_BLOCKER_HELPER = 'packages/desktop/src/renderer/utils/evaosBrokerBlocker.ts';

const FORBIDDEN_STORAGE_OR_URL_PATTERNS = [
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bwindow\.location\b/,
  /\blocation\.href\b/,
  /\bURLSearchParams\b/,
  /\buseSearchParams\b/,
  /\bconsole\.(?:log|info|warn|error|debug)\b/,
];

const SECRET_MARKER_PATTERNS = [
  /desktop[_-]?session/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /provider[_-]?grant/i,
  /grant[_-]?handle/i,
  /\bauthorization\b/i,
  /\bbearer\b/i,
  /\beds_[A-Za-z0-9_-]{4,}\b/i,
  /\bepg_[A-Za-z0-9_-]{4,}\b/i,
  /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/i,
  /\b(?:rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/i,
  /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/i,
  /\bglpat-[A-Za-z0-9_-]{10,}\b/i,
  /\bAIza[0-9A-Za-z_-]{20,}\b/i,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
];

function auditRendererTrustSurfaces(rootDir = process.cwd()) {
  const issues = [];
  const helperPath = path.join(rootDir, SHARED_SAFE_TEXT_HELPER);
  const helperText = fs.existsSync(helperPath) ? fs.readFileSync(helperPath, 'utf8') : '';
  const blockerHelperPath = path.join(rootDir, BROKER_BLOCKER_HELPER);
  const blockerHelperText = fs.existsSync(blockerHelperPath) ? fs.readFileSync(blockerHelperPath, 'utf8') : '';
  const hasSharedSafeTextHelper =
    helperText.includes('SECRET_TEXT_PATTERN') && helperText.includes('function safeEvaosUiText');
  const hasSafeBrokerBlockerHelper =
    blockerHelperText.includes('function evaosBrokerBlockerText') &&
    blockerHelperText.includes('safeEvaosUiText(response?.msg');

  if (helperText && !hasSharedSafeTextHelper) {
    issues.push(`${SHARED_SAFE_TEXT_HELPER}: shared evaOS renderer sanitizer is missing its secret guard`);
  }

  for (const relativePath of TRUST_SURFACE_FILES) {
    const filePath = path.join(rootDir, relativePath);
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split(/\r?\n/);
    const usesSharedSafeText = text.includes('safeEvaosUiText');
    const usesLocalSafeText = text.includes('SECRET_TEXT_PATTERN') && text.includes('function safeUiText');
    const safeTextCallPattern = usesSharedSafeText ? 'safeEvaosUiText(response.msg' : 'safeUiText(response.msg';
    const usesSafeBrokerBlocker = text.includes('evaosBrokerBlockerText(') && hasSafeBrokerBlockerHelper;

    if (!usesLocalSafeText && !(usesSharedSafeText && hasSharedSafeTextHelper)) {
      issues.push(`${relativePath}: missing SECRET_TEXT_PATTERN guard`);
    }
    if (!usesLocalSafeText && !usesSharedSafeText) {
      issues.push(`${relativePath}: missing safeUiText renderer sanitizer`);
    }
    if (!text.includes(safeTextCallPattern) && !usesSafeBrokerBlocker) {
      issues.push(
        `${relativePath}: broker error messages must pass through ${usesSharedSafeText ? 'safeEvaosUiText' : 'safeUiText'}`
      );
    }

    let inSecretPatternDeclaration = false;
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      if (line.includes('SECRET_TEXT_PATTERN')) {
        inSecretPatternDeclaration = true;
      }

      for (const pattern of FORBIDDEN_STORAGE_OR_URL_PATTERNS) {
        if (pattern.test(line)) {
          issues.push(
            `${relativePath}:${lineNumber}: evaOS trust surface must not use renderer storage, URL state, or console logging`
          );
        }
      }

      if (!inSecretPatternDeclaration) {
        for (const pattern of SECRET_MARKER_PATTERNS) {
          if (pattern.test(line)) {
            issues.push(`${relativePath}:${lineNumber}: secret marker ${pattern} appears outside SECRET_TEXT_PATTERN`);
          }
        }
      }

      if (inSecretPatternDeclaration && line.includes(';')) {
        inSecretPatternDeclaration = false;
      }
    });
  }

  return issues;
}

function main() {
  const issues = auditRendererTrustSurfaces(process.cwd());
  if (issues.length > 0) {
    console.error('evaOS renderer secret audit failed:');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log('evaOS renderer secret audit passed.');
}

if (require.main === module) {
  main();
}

module.exports = {
  TRUST_SURFACE_FILES,
  auditRendererTrustSurfaces,
};
