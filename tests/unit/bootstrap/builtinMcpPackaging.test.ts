import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');

function readSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('built-in MCP packaging guardrails', () => {
  it('keeps executable built-in MCP server bundles in electron-builder asarUnpack', () => {
    const builder = readSource('packages/desktop/electron-builder.yml');
    const buildScript = readSource('scripts/build-mcp-servers.js');

    for (const outfile of ['out/main/builtin-mcp-image-gen.js', 'out/main/builtin-mcp-evaos-mac-control.js']) {
      expect(builder).toContain(`'${outfile}'`);
      expect(buildScript).toContain(`'${outfile}'`);
    }
  });

  it('keeps evaOS Mac-control MCP bridge lookup aligned with packaged native companion resources', () => {
    const macControlServer = readSource('packages/desktop/src/process/resources/builtinMcp/evaosMacControlServer.ts');
    const nativeCompanionStatus = readSource('packages/desktop/src/process/services/evaosNativeCompanionStatus.ts');

    expect(macControlServer).toContain('../../../Bridge/evaos-desktop-bridge');
    expect(macControlServer).toContain('../../resources/Bridge/evaos-desktop-bridge');
    expect(nativeCompanionStatus).toContain("join(resourcesPath, 'Bridge', 'evaos-desktop-bridge')");
    expect(nativeCompanionStatus).toContain("resolve(process.cwd(), 'resources', 'Bridge', 'evaos-desktop-bridge')");
  });
});
