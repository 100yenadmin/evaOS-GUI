#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBridge } from '../dist/src/bridge.js';
import { desktopBridgeFirewall } from '../dist/src/firewall.js';

const [, , command, paramsArgument = '{}'] = process.argv;

if (!command) {
  console.error('usage: qa-run-bridge.mjs <bridge-command> [params-json]');
  process.exit(2);
}

let params;
try {
  const paramsJSON = paramsArgument === '-' ? await readStdin() : paramsArgument;
  params = JSON.parse(paramsJSON);
} catch (error) {
  console.error(`invalid params JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

let toolMap;
try {
  toolMap = await loadRegisteredToolMap();
} catch {
  console.log(
    JSON.stringify({
      ok: false,
      errors: [
        {
          code: 'qa_openclaw_tool_registry_invalid',
          message: 'The built OpenClaw plugin tool registry does not match its package contract.',
          guidance: 'Rebuild the OpenClaw plugin and verify its exact registered tool contract.',
        },
      ],
    })
  );
  process.exit(0);
}
const bridgeCommand = toolMap.get(command) || command;
const firewallDecision = desktopBridgeFirewall({
  toolName: command,
  args: params,
});

if (firewallDecision?.block) {
  console.log(
    JSON.stringify({
      ok: false,
      errors: [
        {
          code: 'qa_openclaw_firewall_blocked',
          message: firewallDecision.blockReason || 'OpenClaw desktop bridge firewall blocked this tool call.',
          guidance: 'Use only the registered desktop bridge tools and audited connector command contract.',
        },
      ],
    })
  );
  process.exit(0);
}

if (firewallDecision?.requireApproval) {
  console.log(
    JSON.stringify({
      ok: false,
      errors: [
        {
          code: 'qa_openclaw_firewall_approval_required',
          message: firewallDecision.requireApproval.description,
          guidance: 'Run the dry-run first, collect approval, then rerun with matching approval evidence.',
        },
      ],
    })
  );
  process.exit(0);
}

if (!toolMap.has(command) && command.includes('_')) {
  console.log(
    JSON.stringify({
      ok: false,
      errors: [
        {
          code: 'qa_openclaw_tool_not_registered',
          message: `${command} is not registered by the built OpenClaw plugin entrypoint.`,
          guidance: 'Rebuild the OpenClaw plugin and verify openclaw-plugin/dist/index.js.',
        },
      ],
    })
  );
  process.exit(0);
}

try {
  const result = await runBridge(bridgeCommand, params);
  console.log(JSON.stringify(result));
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      errors: [
        {
          code: 'qa_run_bridge_failed',
          message: error instanceof Error ? error.message : String(error),
          guidance: 'Build the OpenClaw plugin and verify the bridge command shape.',
        },
      ],
    })
  );
  process.exit(0);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8') || '{}';
}

async function loadRegisteredToolMap() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const distIndex = join(scriptDir, '../dist/index.js');
  const packageManifestPath = join(scriptDir, '../package.json');
  const source = await readFile(distIndex, 'utf8');
  const packageManifest = JSON.parse(await readFile(packageManifestPath, 'utf8'));
  const expectedTools = packageManifest?.openclaw?.contracts?.tools;
  if (
    !Array.isArray(expectedTools) ||
    expectedTools.length === 0 ||
    new Set(expectedTools).size !== expectedTools.length
  ) {
    throw new Error('invalid package tool contract');
  }
  const map = new Map();
  const toolCallPattern = /tool\(\s*(['"])([^'"]+)\1\s*,[\s\S]*?,\s*(['"])([A-Za-z0-9]+)\3(?:\s*,|\s*\))/g;
  let match;
  let matchCount = 0;
  while ((match = toolCallPattern.exec(source)) !== null) {
    matchCount += 1;
    map.set(match[2], match[4]);
  }
  if (
    matchCount !== expectedTools.length ||
    map.size !== expectedTools.length ||
    expectedTools.some((name) => typeof name !== 'string' || !map.has(name))
  ) {
    throw new Error('built tool registry mismatch');
  }
  return map;
}
