import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

describe('evaOS decision packet', () => {
  it('documents the macOS-first CI policy so skipped Windows jobs are not beta blockers', () => {
    const decisionPacket = fs.readFileSync(path.join(repoRoot, 'docs/evaos/95-confidence-decision-packet.md'), 'utf8');

    expect(decisionPacket).toContain('## macOS-First CI Policy');
    expect(decisionPacket).toContain('Windows checks are release/nightly or Windows-touching gates');
    expect(decisionPacket).toContain('Intentionally skipped Windows jobs are not public-beta blockers');
  });

  it('tracks the post-merge sprint state instead of stale stack blockers', () => {
    const decisionPacket = fs.readFileSync(path.join(repoRoot, 'docs/evaos/95-confidence-decision-packet.md'), 'utf8');

    expect(decisionPacket).toContain('## Post-Merge Sprint State');
    expect(decisionPacket).toContain('PR #48 merged the combined stack into `evaos/dev`');
    expect(decisionPacket).toContain('PR #49 added the beta release credential inventory');
    expect(decisionPacket).not.toContain('Root stack PR #15 still requires review');
    expect(decisionPacket).not.toContain('The stack is not merged');
  });
});
