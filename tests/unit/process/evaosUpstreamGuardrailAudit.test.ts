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
  EVAOS_UPSTREAM_CANARY_BUCKETS: Array<{
    id: string;
    requiredProof: string;
    pathGlobs: string[];
  }>;
  classifyEvaosUpstreamSeamPaths: (changedPaths: string[]) => Array<{
    id: string;
    requiredProof: string;
    pathGlobs: string[];
    matchedPaths: string[];
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
      defaultImportRange: 'v2.1.12..v2.1.18',
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
      'voice-native-boundary',
      'team-runtime',
      'assistant-governance',
      'aioncore-runtime-pin',
    ]);

    expect(upstreamGuardrailAudit.EVAOS_UPSTREAM_IMPORT_SEAMS.flatMap((seam) => seam.protectedPaths)).toEqual(
      expect.arrayContaining([
        'packages/desktop/src/renderer/components/layout/Router.tsx',
        'packages/desktop/src/renderer/components/layout/Titlebar/index.tsx',
        'packages/desktop/src/common/adapter/ipcBridge.ts',
        'packages/desktop/src/process/bridge/index.ts',
        '.github/workflows/build-and-release.yml',
        'entitlements.plist',
      ])
    );
  });

  it('classifies upstream changed paths into required evaOS canary buckets', () => {
    const classifications = upstreamGuardrailAudit.classifyEvaosUpstreamSeamPaths([
      'packages/desktop/src/common/adapter/ipcBridge.ts',
      'packages/desktop/src/renderer/services/speech/SpeechStreamClient.ts',
      'packages/desktop/src/renderer/pages/team/TeamPage.tsx',
      'packages/desktop/src/renderer/pages/settings/AssistantSettings/index.tsx',
      './packages/desktop/src/common/evaos/nativeCompanionBoundary.ts',
      'packages/desktop/src/process/evaosBetaSafety.ts',
      'packages/shared-scripts/src/prepare-aioncore.js',
      '.github/workflows/release-distribute.yml',
    ]);

    expect(classifications.map((classification) => classification.id).sort()).toEqual([
      'aioncore-runtime',
      'assistant-governance',
      'broker-ipc',
      'native-connector',
      'native-voice',
      'release-identity',
      'runtime-team',
    ]);
    expect(classifications.find((classification) => classification.id === 'native-connector')?.matchedPaths).toEqual([
      'packages/desktop/src/common/evaos/nativeCompanionBoundary.ts',
    ]);
    expect(classifications.find((classification) => classification.id === 'native-voice')?.requiredProof).toContain(
      'microphone permission'
    );
  });

  it('returns no classifier buckets for unrelated upstream files', () => {
    expect(upstreamGuardrailAudit.classifyEvaosUpstreamSeamPaths(['docs/readme/readme_ch.md'])).toEqual([]);
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
      'packages/desktop/src/renderer/components/layout/Router.tsx': '<Routes />',
      'packages/desktop/src/renderer/components/layout/Titlebar/index.tsx': "const appTitle = 'AionUi';",
      'packages/desktop/src/process/bridge/index.ts': 'export function initAllBridges() {}',
      'package.json': '{"name":"AionUi","productName":"AionUi"}',
      '.github/workflows/build-and-release.yml': 'name: upstream release',
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('release-identity'),
        expect.stringContaining('route-contribution'),
        expect.stringContaining('ipc-namespace-registration'),
        expect.stringContaining('update-feed-provider'),
        expect.stringContaining('footer-account-context'),
      ])
    );
  });
});
