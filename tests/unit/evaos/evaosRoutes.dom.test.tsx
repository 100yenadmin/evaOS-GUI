/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Navigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { renderEvaosRoutes } from '@/renderer/evaos/evaosRoutes';

function evaosRouteElements(): Array<React.ReactElement<{ path?: string; element?: React.ReactNode }>> {
  const fragment = renderEvaosRoutes();
  if (!React.isValidElement<{ children?: React.ReactNode }>(fragment)) return [];
  return React.Children.toArray(fragment.props.children).filter(
    (child): child is React.ReactElement<{ path?: string; element?: React.ReactNode }> => React.isValidElement(child)
  );
}

describe('evaosRoutes', () => {
  it('registers old Workbench runtime routes and keeps /openclaw as an /evaos alias', () => {
    const routes = evaosRouteElements();

    expect(routes.map((route) => route.props.path)).toEqual([
      '/openclaw',
      '/evaos',
      '/hermes',
      '/mission-control',
      '/design-workspace',
      '/beta-readiness',
      '/terminal',
      '/native-companion',
      '/approval-center',
      '/connected-apps',
      '/business-browser',
      '/creative-studio',
      '/company-brain',
      '/people-access',
    ]);

    const openclawAlias = routes.find((route) => route.props.path === '/openclaw')?.props.element;
    expect(React.isValidElement(openclawAlias) ? openclawAlias.type : undefined).toBe(Navigate);
    expect(
      React.isValidElement<{ to?: string; replace?: boolean }>(openclawAlias) ? openclawAlias.props : {}
    ).toMatchObject({
      to: '/evaos',
      replace: true,
    });
  });
});
