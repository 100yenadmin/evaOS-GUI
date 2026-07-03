/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { canShowEvaosSupportDiagnostics } from '@/renderer/evaos/supportDiagnostics';

describe('evaOS support diagnostics gate', () => {
  afterEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('hides diagnostics when support mode is off even for admins', () => {
    expect(
      canShowEvaosSupportDiagnostics({
        authenticated: true,
        userEmail: 'admin@electricsheephq.com',
        roles: ['admin'],
        isOperator: true,
      })
    ).toBe(false);
  });

  it('does not let customer members enable diagnostics with localStorage alone', () => {
    localStorage.setItem('evaos.supportDiagnostics', '1');

    expect(
      canShowEvaosSupportDiagnostics({
        authenticated: true,
        userEmail: 'member@example.test',
        roles: ['member'],
        isOperator: false,
      })
    ).toBe(false);
  });

  it('does not expose diagnostics to customer admin roles', () => {
    localStorage.setItem('evaos.supportDiagnostics', '1');

    expect(
      canShowEvaosSupportDiagnostics({
        authenticated: true,
        userEmail: 'company-admin@example.test',
        roles: ['technical-admin'],
        isOperator: false,
      })
    ).toBe(false);
  });

  it('allows support operators only when the broker also marks the session as operator', () => {
    localStorage.setItem('evaos.supportDiagnostics', '1');

    expect(
      canShowEvaosSupportDiagnostics({
        authenticated: true,
        userEmail: 'support@example.test',
        roles: ['support'],
        isOperator: false,
      })
    ).toBe(false);
    expect(
      canShowEvaosSupportDiagnostics({
        authenticated: true,
        userEmail: 'support@example.test',
        roles: ['support'],
        isOperator: true,
      })
    ).toBe(true);
  });

  it('allows known global admin accounts when support diagnostics mode is enabled', () => {
    window.history.replaceState({}, '', '/?evaos_support_diagnostics=1#/evaos');

    expect(
      canShowEvaosSupportDiagnostics({
        authenticated: true,
        userEmail: 'ADMIN@ELECTRICSHEEPHQ.COM',
        roles: ['member'],
        isOperator: false,
      })
    ).toBe(true);
  });
});
