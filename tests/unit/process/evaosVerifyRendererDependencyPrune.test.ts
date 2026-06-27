import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const verifier = require('../../../scripts/evaosVerifyRendererDependencyPrune.js') as {
  rendererOnlyPackages: string[];
  runtimeTransitivePackages: string[];
  verifyRendererDependencyManifest: (packageJsonPath?: string) => {
    checkedRendererPackages: number;
    checkedRuntimeTransitivePackages: number;
  };
  verifyRendererDependencyPrune: (appPath: string) => {
    checkedPackages: number;
    checkedRuntimeTransitivePackages: number;
  };
};

let tempDir: string | undefined;

function align4(value: number) {
  return value + ((4 - (value % 4)) % 4);
}

function addPackage(files: Record<string, unknown>, packageName: string) {
  let current = files;
  for (const part of packageName.split('/')) {
    const entry = (current[part] ??= { files: {} }) as { files: Record<string, unknown> };
    current = entry.files;
  }
}

function writeFakeAsar(appPath: string, packages: string[]) {
  const resources = path.join(appPath, 'Contents', 'Resources');
  fs.mkdirSync(resources, { recursive: true });

  const nodeModules = { files: {} as Record<string, unknown> };
  for (const packageName of packages) {
    addPackage(nodeModules.files, packageName);
  }

  const header = {
    files: packages.length ? { node_modules: nodeModules } : { renderer: { files: {} } },
  };
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const headerPayloadSize = 4 + align4(json.length);
  const headerPickle = Buffer.alloc(4 + headerPayloadSize);
  headerPickle.writeUInt32LE(headerPayloadSize, 0);
  headerPickle.writeInt32LE(json.length, 4);
  json.copy(headerPickle, 8);

  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);

  fs.writeFileSync(path.join(resources, 'app.asar'), Buffer.concat([sizePickle, headerPickle]));
}

function makeApp(packages: string[] = verifier.runtimeTransitivePackages) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaos-renderer-prune-'));
  const appPath = path.join(tempDir, 'AionUi.app');
  writeFakeAsar(appPath, packages);
  return appPath;
}

describe('evaosVerifyRendererDependencyPrune', () => {
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('passes when renderer-only packages are absent from raw package locations', () => {
    const appPath = makeApp();

    expect(verifier.verifyRendererDependencyPrune(appPath)).toEqual({
      checkedPackages: verifier.rendererOnlyPackages.length,
      checkedRuntimeTransitivePackages: verifier.runtimeTransitivePackages.length,
    });
  });

  it('keeps the verifier package lists in sync with package.json buckets', () => {
    expect(verifier.verifyRendererDependencyManifest(require.resolve('../../../package.json'))).toEqual({
      checkedRendererPackages: verifier.rendererOnlyPackages.length,
      checkedRuntimeTransitivePackages: verifier.runtimeTransitivePackages.length,
    });
  });

  it('fails if any moved renderer dependency ships inside app.asar node_modules', () => {
    const appPath = makeApp([...verifier.runtimeTransitivePackages, ...verifier.rendererOnlyPackages]);

    expect(() => verifier.verifyRendererDependencyPrune(appPath)).toThrow(verifier.rendererOnlyPackages[0]);

    try {
      verifier.verifyRendererDependencyPrune(appPath);
      throw new Error('Expected verifier to fail');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const packageName of verifier.rendererOnlyPackages) {
        expect(message).toContain(packageName);
      }
    }
  });

  it('fails if a moved renderer dependency ships inside app.asar.unpacked node_modules', () => {
    const appPath = makeApp();
    const leakedPackage = 'react-router-dom';
    fs.mkdirSync(
      path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', ...leakedPackage.split('/')),
      { recursive: true }
    );

    expect(() => verifier.verifyRendererDependencyPrune(appPath)).toThrow(leakedPackage);
  });

  it('fails if a runtime-transitive dependency is missing from the packaged app', () => {
    const missingPackage = verifier.runtimeTransitivePackages[0];
    const appPath = makeApp(verifier.runtimeTransitivePackages.filter((packageName) => packageName !== missingPackage));

    expect(() => verifier.verifyRendererDependencyPrune(appPath)).toThrow(missingPackage);
  });
});
