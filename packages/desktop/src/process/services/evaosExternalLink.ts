/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { shell } from 'electron';
import type { IEvaosExternalLinkOpenRequest, IEvaosExternalLinkOpenResult } from '@/common/evaos/bridgeTypes';

const ALLOWED_HTTPS_HOSTS = new Set(['electricsheephq.com', 'www.electricsheephq.com']);
const SUPPORT_MAILBOX = 'support@electricsheephq.com';
const RELEASE_REPOSITORY_PATH = '/100yenadmin/evaos-gui';

export async function openEvaosExternalLink(
  request: IEvaosExternalLinkOpenRequest
): Promise<IEvaosExternalLinkOpenResult> {
  const url = validateEvaosExternalUrl(request.url);
  await shell.openExternal(url);
  return {
    opened: true,
    url,
    message: 'Opened evaOS support link.',
  };
}

function validateEvaosExternalUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('Invalid evaOS support link.');
  }

  if (parsed.protocol === 'mailto:') {
    const mailbox = parsed.pathname.trim().toLowerCase();
    if (mailbox === SUPPORT_MAILBOX) return parsed.toString();
    throw new Error('Unsupported evaOS support mailbox.');
  }

  if (parsed.protocol === 'https:' && ALLOWED_HTTPS_HOSTS.has(parsed.hostname.toLowerCase())) {
    return parsed.toString();
  }

  if (
    parsed.protocol === 'https:' &&
    parsed.hostname.toLowerCase() === 'github.com' &&
    parsed.pathname.toLowerCase().startsWith(RELEASE_REPOSITORY_PATH)
  ) {
    return parsed.toString();
  }

  throw new Error('Unsupported evaOS external link.');
}
