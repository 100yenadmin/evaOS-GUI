/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

type Env = NodeJS.ProcessEnv;

export const EVAOS_BETA_ENV = 'AIONUI_EVAOS_BETA';
export const EVAOS_BETA_UPDATE_REPO_ENV = 'AIONUI_EVAOS_BETA_UPDATE_REPO';
export const EVAOS_BETA_ALLOW_AUTO_UPDATE_ENV = 'AIONUI_EVAOS_BETA_ALLOW_AUTO_UPDATE';
export const EVAOS_BETA_ALLOW_SENTRY_ENV = 'AIONUI_EVAOS_BETA_ALLOW_SENTRY';
export const EVAOS_BETA_ALLOW_SENTRY_DEVICE_ID_ENV = 'AIONUI_EVAOS_BETA_ALLOW_SENTRY_DEVICE_ID';
export const EVAOS_BETA_ALLOW_STARTUP_LOGS_ENV = 'AIONUI_EVAOS_BETA_ALLOW_STARTUP_LOGS';
export const EVAOS_BETA_ALLOW_REMOTE_WEBUI_ENV = 'AIONUI_EVAOS_BETA_ALLOW_REMOTE_WEBUI';
const EVAOS_BETA_ALLOWED_UPDATE_REPOS = new Set(['100yenadmin/AionUi']);

export const EVAOS_BETA_IDENTITY = {
  productName: 'evaOS Workbench Beta',
  executableName: 'EvaOSWorkbenchBeta',
  appId: 'com.evaos.workbench.beta',
  protocolScheme: 'evaos-workbench-beta',
  loopbackCallbackPath: '/auth/evaos-workbench-beta/callback',
} as const;

export const EVAOS_BETA_UPDATE_DISABLED_MESSAGE =
  'Updates are disabled for evaOS Workbench Beta until an evaOS-owned beta update feed is configured.';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isTruthyEnv(value: string | undefined): boolean {
  return TRUE_VALUES.has((value ?? '').trim().toLowerCase());
}

export function isEvaosBetaBuild(env: Env = process.env): boolean {
  if (env[EVAOS_BETA_ENV] === undefined) {
    return true;
  }
  return isTruthyEnv(env[EVAOS_BETA_ENV]);
}

export function getEvaosBetaUpdateRepo(env: Env = process.env): string | undefined {
  const repo = env[EVAOS_BETA_UPDATE_REPO_ENV]?.trim();
  return repo || undefined;
}

export function isAllowedEvaosBetaUpdateRepo(repo: string | undefined): boolean {
  return !!repo && EVAOS_BETA_ALLOWED_UPDATE_REPOS.has(repo);
}

export function shouldDisableAutoUpdate(env: Env = process.env): boolean {
  if (!isEvaosBetaBuild(env)) {
    return isTruthyEnv(env.AIONUI_DISABLE_AUTO_UPDATE);
  }
  return (
    !isTruthyEnv(env[EVAOS_BETA_ALLOW_AUTO_UPDATE_ENV]) || !isAllowedEvaosBetaUpdateRepo(getEvaosBetaUpdateRepo(env))
  );
}

export function shouldDisableSentry(env: Env = process.env): boolean {
  if (!env.SENTRY_DSN) return true;
  if (!isEvaosBetaBuild(env)) return false;
  return !isTruthyEnv(env[EVAOS_BETA_ALLOW_SENTRY_ENV]);
}

export function shouldAttachSentryDeviceId(env: Env = process.env): boolean {
  if (!isEvaosBetaBuild(env)) return true;
  return isTruthyEnv(env[EVAOS_BETA_ALLOW_SENTRY_DEVICE_ID_ENV]);
}

export function shouldSendStartupLogReport(env: Env = process.env): boolean {
  if (!isEvaosBetaBuild(env)) return true;
  return isTruthyEnv(env[EVAOS_BETA_ALLOW_STARTUP_LOGS_ENV]);
}

export function shouldAllowRemoteWebUI(env: Env = process.env): boolean {
  if (!isEvaosBetaBuild(env)) return true;
  return isTruthyEnv(env[EVAOS_BETA_ALLOW_REMOTE_WEBUI_ENV]);
}

type DefaultProtocolClientRegistrationInput = {
  protocolScheme: string;
  isPackaged: boolean;
  isDefaultApp: boolean;
};

export function shouldRegisterDefaultProtocolClient(input: DefaultProtocolClientRegistrationInput): boolean {
  return !(input.protocolScheme === EVAOS_BETA_IDENTITY.protocolScheme && input.isDefaultApp && !input.isPackaged);
}
