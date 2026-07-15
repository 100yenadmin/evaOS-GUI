import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const manifest = require('../../../packages/mac-connector-core/scripts/coreManifest.js') as {
  copyCorePythonSource: (
    coreRoot: string,
    resourceRoot: string
  ) => {
    coreSourceSha256: string;
    sourceManifestSha256: string;
  };
  coreSourceIdentity: (coreRoot: string) => {
    coreSourceSha256: string;
    sourceManifestSha256: string;
    manifest: { files: Array<{ path: string; destination: string | null; mode: number; sha256: string }> };
  };
  verifyGeneratedCoreSource: (coreRoot: string, resourceRoot: string) => unknown;
};

const coreRoot = join(process.cwd(), 'packages', 'mac-connector-core');
const tempDirs: string[] = [];

function temporaryCore(): string {
  const root = mkdtempSync(join(tmpdir(), 'evaos-mac-core-'));
  tempDirs.push(root);
  cpSync(coreRoot, root, { recursive: true });
  return root;
}

function fileSnapshot(root: string): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) result.push([absolute.slice(root.length + 1), readFileSync(absolute).toString('hex')]);
    }
  }
  return result.toSorted(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('canonical Mac connector core packaging', () => {
  it('uses one strict sorted allowlist and deterministic generated Python source', () => {
    const identity = manifest.coreSourceIdentity(coreRoot);
    expect(identity.coreSourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.sourceManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    const paths = identity.manifest.files.map((entry) => entry.path);
    expect(paths).toEqual(paths.toSorted((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))));
    expect(new Set(paths).size).toBe(paths.length);
    expect(identity.manifest.files.every((entry) => entry.mode === 0o644 || entry.mode === 0o755)).toBe(true);

    const first = mkdtempSync(join(tmpdir(), 'evaos-generated-core-a-'));
    const second = mkdtempSync(join(tmpdir(), 'evaos-generated-core-b-'));
    tempDirs.push(first, second);
    expect(manifest.copyCorePythonSource(coreRoot, first).coreSourceSha256).toBe(identity.coreSourceSha256);
    expect(manifest.copyCorePythonSource(coreRoot, second).sourceManifestSha256).toBe(identity.sourceManifestSha256);
    expect(fileSnapshot(first)).toEqual(fileSnapshot(second));
    expect(() => manifest.verifyGeneratedCoreSource(coreRoot, first)).not.toThrow();
  });

  it('fails closed for tampered, unlisted, missing, or symlinked canonical source', () => {
    const tampered = temporaryCore();
    const apiPath = join(tampered, 'python', 'evaos_desktop_bridge', 'host', 'api.py');
    writeFileSync(apiPath, `${readFileSync(apiPath, 'utf8')}\n# tampered\n`);
    expect(() => manifest.coreSourceIdentity(tampered)).toThrow(/digest mismatch/);

    const unlisted = temporaryCore();
    writeFileSync(join(unlisted, 'python', 'evaos_desktop_bridge', 'injected.py'), 'raise RuntimeError()\n');
    expect(() => manifest.coreSourceIdentity(unlisted)).toThrow(/manifest drift/);

    const missing = temporaryCore();
    rmSync(join(missing, 'python', 'evaos_desktop_bridge', 'contracts', 'types.py'));
    expect(() => manifest.coreSourceIdentity(missing)).toThrow(/manifest drift/);

    const linked = temporaryCore();
    const linkedPath = join(linked, 'python', 'evaos_desktop_bridge', 'linked.py');
    symlinkSync('host/api.py', linkedPath);
    expect(() => manifest.coreSourceIdentity(linked)).toThrow(/symbolic link/);

    const linkedRoot = temporaryCore();
    rmSync(join(linkedRoot, 'native'), { recursive: true });
    symlinkSync(join(coreRoot, 'native'), join(linkedRoot, 'native'), 'dir');
    expect(() => manifest.coreSourceIdentity(linkedRoot)).toThrow(/not a real directory/);
  });

  it('keeps the host API dependency-injected and the package fanout bounded', () => {
    const api = readFileSync(join(coreRoot, 'python', 'evaos_desktop_bridge', 'host', 'api.py'), 'utf8');
    const imports = api
      .split('\n')
      .filter((line) => line.startsWith('import ') || line.startsWith('from '))
      .join('\n');
    for (const forbidden of ['electron', 'renderer', 'connector_server', 'http.server', 'tailscale', 'subprocess']) {
      expect(imports.toLowerCase()).not.toContain(forbidden);
    }
    expect(readdirSync(coreRoot, { withFileTypes: true }).length).toBeLessThanOrEqual(6);
    expect(
      readdirSync(join(coreRoot, 'python', 'evaos_desktop_bridge'), { withFileTypes: true }).length
    ).toBeLessThanOrEqual(7);
  });
});
