/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import EvaosDashboardHandoffPage from '@renderer/pages/evaos-dashboard-handoff';

const SECRET_TEXT_PATTERN =
  /(eds_|epg_|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|authorization|bearer|secret|password)/i;
const PEOPLE_ACCESS_DASHBOARD_URL = 'https://www.electricsheephq.com/dashboard/invites';

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed;
}

function safeBrokerMessage(response: { msg?: string }, fallback: string): string {
  return safeUiText(response.msg, fallback);
}

const PEOPLE_ACCESS_COPY = {
  title: safeUiText('People & Access', 'People & Access'),
  description: safeBrokerMessage(
    {
      msg: 'Manage seats, invitations, and account access from the production Electric Sheep dashboard for this controlled RC.',
    },
    'Open the production Electric Sheep dashboard for this controlled RC.'
  ),
};

const PeopleAccessPage: React.FC = () => (
  <EvaosDashboardHandoffPage
    title={PEOPLE_ACCESS_COPY.title}
    eyebrow='Team permissions'
    description={PEOPLE_ACCESS_COPY.description}
    dashboardUrl={PEOPLE_ACCESS_DASHBOARD_URL}
    issueRef='#262'
  />
);

export default PeopleAccessPage;
