/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const SECRET_TEXT_PATTERN =
  /\b(?:eds|epg|sk|pk|rk|ghp|github_pat)_[A-Za-z0-9_-]{4,}\b|(?:access|refresh|desktop|provider|grant|api|auth|session)[_-]?(?:token|secret|key|grant|handle|session)|authorization|bearer|client_secret|password|private[_-]?key|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;

function normalizeSafeText(value: string, maxLength: number): string | null {
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return null;
  return trimmed.length > maxLength ? `${trimmed.slice(0, Math.max(0, maxLength - 3))}...` : trimmed;
}

/**
 * Returns renderer-safe user-interface text by rejecting empty or secret-like broker strings.
 *
 * @param value Candidate text from broker, backend, or renderer context.
 * @param fallback Safe fallback text to use when value is absent or rejected.
 * @param maxLength Maximum returned string length; values below 3 are clamped.
 * @returns Sanitized display text, sanitized fallback text, or an empty string if both are unsafe.
 */
export function safeEvaosUiText(value: unknown, fallback: string, maxLength = 220): string {
  const safeMaxLength = Number.isFinite(maxLength) ? Math.max(3, Math.floor(maxLength)) : 220;
  if (typeof value === 'string') {
    const primary = normalizeSafeText(value, safeMaxLength);
    if (primary) return primary;
  }
  return normalizeSafeText(fallback, safeMaxLength) ?? '';
}
