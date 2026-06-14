/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import EvaosDashboardHandoffPage from '@renderer/pages/evaos-dashboard-handoff';

const SECRET_TEXT_PATTERN =
  /(eds_|epg_|access[_-]?token|refresh[_-]?token|desktop[_-]?session|provider[_-]?grant|authorization|bearer|secret|password)/i;
const COMPANY_BRAIN_DASHBOARD_URL = 'https://www.electricsheephq.com/dashboard/company-brain';

function safeUiText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || SECRET_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed;
}

function safeBrokerMessage(response: { msg?: string }, fallback: string): string {
  return safeUiText(response.msg, fallback);
}

const COMPANY_BRAIN_COPY = {
  title: safeUiText('Company Brain', 'Company Brain'),
  description: safeBrokerMessage(
    {
      msg: 'Company Brain is still in beta. For this controlled RC, keep using the production Electric Sheep dashboard while native Workbench parity is finished.',
    },
    'Open the production Electric Sheep dashboard while native Workbench parity is finished.'
  ),
};

const CompanyBrainPage: React.FC = () => (
  <EvaosDashboardHandoffPage
    title={COMPANY_BRAIN_COPY.title}
    eyebrow='Company intelligence'
    description={COMPANY_BRAIN_COPY.description}
    dashboardUrl={COMPANY_BRAIN_DASHBOARD_URL}
    issueRef='#178'
    targetLabel='Open dashboard'
    targetDescription='Company Brain is not yet a finished native Workbench surface. This controlled RC links to the production dashboard while native parity is tracked.'
    buttonLabel='Open dashboard'
  />
);

export default CompanyBrainPage;
