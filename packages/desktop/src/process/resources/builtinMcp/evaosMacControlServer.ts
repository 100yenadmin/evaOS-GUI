/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BUILTIN_EVAOS_MAC_CONTROL_NAME } from './constants';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const BRIDGE_TIMEOUT_MS = 30_000;
const BRIDGE_MAX_BUFFER = 10 * 1024 * 1024;

const SENSITIVE_KEY_PATTERN =
  /(^|_)(token|secret|password|authorization|cookie|connector_url|launch_url|preauth|tailnet_ip|host|ip|endpoint|url)($|_)/i;
const URL_PATTERN = /https?:\/\/[^\s"')\]]+/gi;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

function redactString(value: string): string {
  return value.replace(URL_PATTERN, '[redacted-url]').replace(IPV4_PATTERN, '[redacted-ip]');
}

function redactJson(value: unknown, key = ''): JsonValue {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[redacted]';
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item)) as JsonValue[];
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
      childKey,
      redactJson(childValue, childKey),
    ]);
    return Object.fromEntries(entries) as { [key: string]: JsonValue };
  }
  return String(value);
}

function textResult(value: unknown, isError = false) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(redactJson(value), null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function candidateBridgePaths(): string[] {
  return [
    process.env.EVAOS_DESKTOP_BRIDGE_BIN,
    process.env.EVAOS_WORKBENCH_BRIDGE_BIN,
    path.resolve(__dirname, '../../../Bridge/evaos-desktop-bridge'),
    path.resolve(__dirname, '../../Bridge/evaos-desktop-bridge'),
    path.resolve(__dirname, '../../resources/Bridge/evaos-desktop-bridge'),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function resolveBridgeBinary(): string {
  for (const candidate of candidateBridgePaths()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'evaos-desktop-bridge';
}

async function runBridge(args: string[]) {
  const bridge = resolveBridgeBinary();

  return await new Promise<ReturnType<typeof textResult>>((resolve) => {
    execFile(
      bridge,
      args,
      {
        shell: false,
        timeout: BRIDGE_TIMEOUT_MS,
        maxBuffer: BRIDGE_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        const stdoutText = stdout?.toString().trim() || '';
        let parsed: unknown = stdoutText;
        try {
          parsed = stdoutText ? JSON.parse(stdoutText) : {};
        } catch {
          parsed = stdoutText;
        }

        if (!error) {
          resolve(textResult(parsed));
          return;
        }

        const nodeError = error as NodeJS.ErrnoException;
        const errorCode =
          nodeError.code === 'ENOENT' ? 'evaos_mac_control_bridge_missing' : 'evaos_mac_control_bridge_failed';
        resolve(
          textResult(
            {
              ok: false,
              error_code: errorCode,
              command: 'evaos-desktop-bridge',
              message:
                errorCode === 'evaos_mac_control_bridge_missing'
                  ? 'The bundled evaOS desktop bridge binary was not found.'
                  : error.message,
              stdout: parsed,
              stderr: redactString(stderr?.toString().trim() || ''),
            },
            true
          )
        );
      }
    );
  });
}

function approvalArgs(params: { approval_audit_id?: string }): string[] {
  return params.approval_audit_id ? ['--approval-audit-id', params.approval_audit_id] : [];
}

function dryRunArgs(params: { dry_run?: boolean }): string[] {
  return params.dry_run === false ? [] : ['--dry-run'];
}

function optionalStringArg(flag: string, value?: string): string[] {
  return value ? [flag, value] : [];
}

function optionalNumberArg(flag: string, value?: number): string[] {
  return typeof value === 'number' ? [flag, String(value)] : [];
}

async function main() {
  const server = new McpServer({
    name: BUILTIN_EVAOS_MAC_CONTROL_NAME,
    version: '1.0.0',
  });

  server.tool('customer_mac_status', 'Read the paired evaOS Mac connector status.', {}, async () =>
    runBridge(['customer-mac', 'status', '--json'])
  );

  server.tool('customer_mac_capabilities', 'Read available evaOS Mac-control capabilities.', {}, async () =>
    runBridge(['customer-mac', 'capabilities', '--json'])
  );

  server.tool('desktop_control_status', 'Read current desktop-control session status.', {}, async () =>
    runBridge(['customer-mac', 'control', 'status', '--json'])
  );

  server.tool(
    'desktop_control_start',
    'Start a visible supervised Mac-control session. Prefer ask-permission unless the user explicitly approved full access.',
    {
      mode: z.enum(['full-access', 'ask-permission']).default('ask-permission'),
      agent_label: z.string().optional(),
    },
    async ({ mode, agent_label }) =>
      runBridge([
        'customer-mac',
        'control',
        'start',
        '--json',
        '--mode',
        mode,
        ...optionalStringArg('--agent-label', agent_label),
      ])
  );

  server.tool('desktop_control_stop', 'Stop the active supervised Mac-control session.', {}, async () =>
    runBridge(['customer-mac', 'control', 'stop', '--json'])
  );

  server.tool('desktop_kill_switch', 'Fail closed and revoke active desktop-control access.', {}, async () =>
    runBridge(['customer-mac', 'control', 'kill-switch', '--json'])
  );

  server.tool(
    'desktop_see',
    'Inspect the visible desktop state through the approved evaOS Mac connector.',
    {
      max_chars: z.number().int().min(1).max(20000).default(12000),
      max_nodes: z.number().int().min(1).max(1000).default(300),
    },
    async ({ max_chars, max_nodes }) =>
      runBridge([
        'customer-mac',
        'desktop',
        'see',
        '--json',
        '--max-chars',
        String(max_chars),
        '--max-nodes',
        String(max_nodes),
      ])
  );

  server.tool(
    'desktop_click',
    'Click a visible desktop target. Defaults to dry-run; use dry_run=false only after explicit user approval.',
    {
      snapshot_id: z.string().optional(),
      element_id: z.string().optional(),
      target_label: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      dry_run: z.boolean().default(true),
      approval_audit_id: z.string().optional(),
    },
    async (params) =>
      runBridge([
        'customer-mac',
        'desktop',
        'click',
        '--json',
        ...optionalStringArg('--snapshot-id', params.snapshot_id),
        ...optionalStringArg('--element-id', params.element_id),
        ...optionalStringArg('--target-label', params.target_label),
        ...optionalNumberArg('--x', params.x),
        ...optionalNumberArg('--y', params.y),
        ...dryRunArgs(params),
        ...approvalArgs(params),
      ])
  );

  server.tool(
    'desktop_type',
    'Type text into the visible desktop. Defaults to dry-run; use dry_run=false only after explicit user approval.',
    {
      text: z.string().min(1),
      dry_run: z.boolean().default(true),
      approval_audit_id: z.string().optional(),
    },
    async (params) =>
      runBridge([
        'customer-mac',
        'desktop',
        'type',
        '--json',
        '--text',
        params.text,
        ...dryRunArgs(params),
        ...approvalArgs(params),
      ])
  );

  server.tool(
    'desktop_hotkey',
    'Press a desktop hotkey. Defaults to dry-run; use dry_run=false only after explicit user approval.',
    {
      keys: z.string().min(1),
      dry_run: z.boolean().default(true),
      approval_audit_id: z.string().optional(),
    },
    async (params) =>
      runBridge([
        'customer-mac',
        'desktop',
        'hotkey',
        '--json',
        '--keys',
        params.keys,
        ...dryRunArgs(params),
        ...approvalArgs(params),
      ])
  );

  server.tool(
    'desktop_bridge_audit_tail',
    'Read recent redacted desktop-bridge audit events for proof packets.',
    {
      limit: z.number().int().min(1).max(100).default(20),
    },
    async ({ limit }) => runBridge(['audit-tail', '--json', '--limit', String(limit)])
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('[EvaosMacControlMCP] Fatal error:', error);
  process.exit(1);
});
