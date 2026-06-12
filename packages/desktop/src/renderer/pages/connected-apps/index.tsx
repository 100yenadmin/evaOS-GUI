/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import EvaosDashboardHandoffPage from '@renderer/pages/evaos-dashboard-handoff';

const SECRET_TEXT_PATTERN =
  /(eds_|epg_|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|authorization|bearer|secret|password)/i;
const CONNECTED_APPS_DASHBOARD_URL = 'https://www.electricsheephq.com/dashboard/providers';

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed;
}

function safeBrokerMessage(response: { msg?: string }, fallback: string): string {
  return safeUiText(response.msg, fallback);
}

const CONNECTED_APPS_COPY = {
  title: safeUiText('Connected Apps', 'Connected Apps'),
  description: safeBrokerMessage(
    {
      msg: 'Connect, review, and revoke provider access from the production Electric Sheep dashboard for this controlled RC.',
    },
    'Open the production Electric Sheep dashboard for this controlled RC.'
  ),
};

const ConnectedAppsPage: React.FC = () => (
  <EvaosDashboardHandoffPage
    title={CONNECTED_APPS_COPY.title}
    eyebrow='Provider access'
    description={CONNECTED_APPS_COPY.description}
    dashboardUrl={CONNECTED_APPS_DASHBOARD_URL}
    issueRef='#262'
  />
);

export default ConnectedAppsPage;
