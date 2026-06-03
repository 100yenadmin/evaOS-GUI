import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const sprintPacketAudit = require('../../../scripts/evaosSprintPacketAudit.js') as {
  collectPacketIssues: (packetRoot: string) => string[];
  collectRepoHandoffIssues: (rootDir: string) => string[];
};

const repoRoot = path.resolve(__dirname, '../../..');

function writePacket(root: string, name: string, files: Record<string, string>) {
  const packetDir = path.join(root, name);
  fs.mkdirSync(path.join(packetDir, 'artifacts'), { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(packetDir, file), text);
  }
}

describe('evaOS sprint packet audit', () => {
  it('passes the repository handoff template audit', () => {
    expect(sprintPacketAudit.collectRepoHandoffIssues(repoRoot)).toEqual([]);
  });

  it('passes complete issue packet directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-packets-'));
    try {
      writePacket(root, '01-agent-handoff', {
        'decision.md': '# Decision\n\nRecommendation: use the packet audit.\nConfidence: 0.95\n',
        'proof.md': '# Proof\n\nPrimitive canary: passed.\nScenario canary: passed.\n',
        'negative-proof.md': '# Negative Proof\n\nExpired session fails closed.\n',
        'takeover.md': '# Takeover\n\nCurrent branch: evaos/test.\nNext safe action: review.\n',
      });

      expect(sprintPacketAudit.collectPacketIssues(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when packet evidence is missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-packets-missing-'));
    try {
      const packetDir = path.join(root, '02-missing-proof');
      fs.mkdirSync(packetDir, { recursive: true });
      fs.writeFileSync(path.join(packetDir, 'decision.md'), '# Decision\n\nRecommendation: incomplete.\n');

      expect(sprintPacketAudit.collectPacketIssues(root)).toEqual(
        expect.arrayContaining([
          '02-missing-proof: missing proof.md',
          '02-missing-proof: missing negative-proof.md',
          '02-missing-proof: missing takeover.md',
          '02-missing-proof: missing artifacts/ directory',
        ])
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
