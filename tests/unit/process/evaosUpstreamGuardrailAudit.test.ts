import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const upstreamGuardrailAudit = require('../../../scripts/evaosUpstreamGuardrailAudit.js') as {
  EVAOS_UPSTREAM_ALIGNMENT_TARGET: {
    targetTag: string;
    targetSha: string;
    defaultImportRange: string;
    optionalMainCommit: string;
    optionalMainCommitScope: string;
  };
  EVAOS_UPSTREAM_IMPORT_SEAMS: Array<{
    id: string;
    owner: string;
    protectedPaths: string[];
  }>;
  collectEvaosUpstreamGuardrailIssues: (rootDir: string) => string[];
  collectEvaosUpstreamGuardrailIssuesFromFiles: (files: Record<string, string>) => string[];
};

const repoRoot = path.resolve(__dirname, '../../..');

describe('evaOS upstream import guardrail audit', () => {
  it('pins the Milestone 2 upstream target without opting into live main', () => {
    expect(upstreamGuardrailAudit.EVAOS_UPSTREAM_ALIGNMENT_TARGET).toEqual({
      targetTag: 'v2.1.18',
      targetSha: 'ddd20d3',
      defaultImportRange: 'v2.1.13..v2.1.18',
      optionalMainCommit: '57aa0d0',
      optionalMainCommitScope: 'voice-stt-only',
    });
  });

  it('documents the mixed shell seams that must be reviewed for every upstream import', () => {
    expect(upstreamGuardrailAudit.EVAOS_UPSTREAM_IMPORT_SEAMS.map((seam) => seam.id)).toEqual([
      'route-contribution',
      'sidebar-contribution',
      'footer-account-context',
      'deep-link-session-adapter',
      'update-feed-provider',
      'ipc-namespace-registration',
      'native-connector-boundary',
      'release-identity',
    ]);

    expect(upstreamGuardrailAudit.EVAOS_UPSTREAM_IMPORT_SEAMS.flatMap((seam) => seam.protectedPaths)).toEqual(
      expect.arrayContaining(['packages/desktop/src/common/adapter/ipcBridge.ts'])
    );
  });

  it('passes against the current evaOS fork before upstream imports land', () => {
    expect(upstreamGuardrailAudit.collectEvaosUpstreamGuardrailIssues(repoRoot)).toEqual([]);
  });

  it('reports precise missing markers when an upstream import erases evaOS ownership', () => {
    const issues = upstreamGuardrailAudit.collectEvaosUpstreamGuardrailIssuesFromFiles({
      'packages/desktop/src/common/evaos/betaIdentity.ts': "export const NAME = 'AionUi';",
      'packages/desktop/src/renderer/evaos/evaosRoutes.tsx': "<Route path='/openclaw' />",
      'packages/desktop/src/common/adapter/ipcBridge.ts': 'export const shell = {};',
      'packages/desktop/src/process/evaosBetaSafety.ts': "const repo = 'iOfficeAI/AionUi';",
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('release-identity'),
        expect.stringContaining('route-contribution'),
        expect.stringContaining('ipc-namespace-registration'),
        expect.stringContaining('update-feed-provider'),
      ])
    );
  });
});
