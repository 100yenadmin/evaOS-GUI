import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { desktopBridgeFirewall } from '../dist/src/firewall.js';
import { applyToolParameterDefaults } from '../dist/src/toolParameters.js';

test('applies advertised false and true defaults before bridge execution', () => {
  const live = applyToolParameterDefaults(
    { properties: { dry_run: { type: 'boolean', default: false }, amount: { type: 'integer', default: 600 } } },
    {}
  );
  assert.deepEqual(live, { dry_run: false, amount: 600 });

  const guarded = applyToolParameterDefaults({ properties: { dry_run: { type: 'boolean', default: true } } }, {});
  assert.deepEqual(guarded, { dry_run: true });
  assert.deepEqual(applyToolParameterDefaults({ properties: { dry_run: { default: false } } }, { dry_run: true }), {
    dry_run: true,
  });
});

test('blocks a forbidden control-enablement phrase even after an allowed primitive match', () => {
  for (const [toolName, text, forbidden] of [
    ['desktop_type', 'coordinate Screen Sharing enable', 'Screen Sharing enable'],
    ['desktop_type', 'swipe Remote Management enable', 'Remote Management enable'],
    ['desktop_type', 'drag kickstart -activate', 'kickstart -activate'],
  ]) {
    const decision = desktopBridgeFirewall({ toolName, args: { text } });
    assert.equal(decision?.block, true);
    assert.match(decision?.blockReason || '', new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});

test('built QA bridge recognizes the complete formatted plugin registry', () => {
  const script = fileURLToPath(new URL('../scripts/qa-run-bridge.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'desktop_bridge_status'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.notEqual(payload?.errors?.[0]?.code, 'qa_openclaw_tool_not_registered');
  assert.notEqual(payload?.errors?.[0]?.code, 'qa_openclaw_tool_registry_invalid');
});
