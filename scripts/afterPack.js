const { Arch } = require('builder-util');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const {
  normalizeArch,
  rebuildSingleModule,
  verifyModuleBinary,
  getModulesToRebuild,
} = require('./rebuildNativeModules');
const { normalizeManagedResourcesBundle } = require('../packages/shared-scripts/src/prepare-aioncore.js');
const { clearCompletedAfterPack, markCompletedAfterPack } = require('./dmgRetryEligibility');

/**
 * afterPack hook for electron-builder
 * Rebuilds native modules for cross-architecture builds
 */

const MACHO_MAGICS = new Set([
  'feedface',
  'feedfacf',
  'cefaedfe',
  'cffaedfe',
  'cafebabe',
  'bebafeca',
  'cafebabf',
  'bfbafeca',
]);

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on', 'evaos-beta'].includes(
    String(value || '')
      .trim()
      .toLowerCase()
  );
}

function resolveResourcesDir(electronPlatformName, appOutDir, packager) {
  if (electronPlatformName !== 'darwin') return path.join(appOutDir, 'resources');

  const appName = packager?.appInfo?.productFilename || 'AionUi';
  return path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
}

function getBackendBinaryName(electronPlatformName) {
  return electronPlatformName === 'win32' ? 'aioncore.exe' : 'aioncore';
}

function getManagedNodeBinaryName(electronPlatformName) {
  return electronPlatformName === 'win32' ? 'node.exe' : 'node';
}

function getManagedNodeExecutableParts(electronPlatformName) {
  return electronPlatformName === 'win32'
    ? [getManagedNodeBinaryName(electronPlatformName)]
    : ['bin', getManagedNodeBinaryName(electronPlatformName)];
}

function requirePackagedResource(resourcesDir, relativePath, missing) {
  const absolutePath = path.join(resourcesDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    missing.push(relativePath);
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Packaged app has unreadable AionCore manifest: ${filePath} (${error.message})`);
  }
}

function getPathSegments(relativePath) {
  return String(relativePath || '')
    .split(/[\\/]+/)
    .filter(Boolean);
}

function normalizeResourceEntry(entry) {
  return String(entry || '').replace(/\\/g, '/');
}

function isPrunedAcpPath(relativePath) {
  const segments = getPathSegments(normalizeResourceEntry(relativePath));
  return segments.some((segment) => {
    const normalized = segment.toLowerCase().replace(/[_-]/g, '');
    return normalized === 'acp' || normalized === 'acpadapter' || normalized === 'acpadapters';
  });
}

function listPackagedManagedResourceEntries(rootDir, relativeDir = '') {
  if (!fs.existsSync(rootDir)) return null;

  const currentDir = path.join(rootDir, relativeDir);
  const entries = [];
  for (const entry of fs
    .readdirSync(currentDir, { withFileTypes: true })
    .toSorted((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = normalizeResourceEntry(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) {
      entries.push(`${relativePath}/`);
      entries.push(...(listPackagedManagedResourceEntries(rootDir, relativePath) || []));
    } else {
      entries.push(relativePath);
    }
  }

  return entries;
}

function requireNoAcpManagedResources(runtimeDir, manifest, missing) {
  const managedResourcesPath =
    manifest?.managedResourcesBundleResult?.managedResourcesPath ||
    manifest?.resourceShape?.managedResources?.relativePath ||
    'managed-resources';
  const managedResourcesDir = path.join(runtimeDir, managedResourcesPath);
  const packagedResources = listPackagedManagedResourceEntries(managedResourcesDir);
  if (!packagedResources) return;

  const forbiddenPackagedResources = packagedResources.filter(isPrunedAcpPath);
  if (forbiddenPackagedResources.length > 0) {
    missing.push(
      `forbidden no-acp managed resource(s) still packaged: ${forbiddenPackagedResources
        .map((entry) => path.join(managedResourcesPath, entry))
        .join(', ')}`
    );
  }
}

function verifyManagedResourcesBundleManifest(runtimeDir, manifest, missing) {
  if (manifest?.managedResourcesBundle == null) return;
  const bundleMode = normalizeManagedResourcesBundle(manifest.managedResourcesBundle);
  if (bundleMode !== 'no-acp') return;

  const result = manifest?.managedResourcesBundleResult;
  if (!result || result.mode !== 'no-acp') {
    missing.push('manifest managedResourcesBundleResult.mode');
  }
  const prunedResources = Array.isArray(result?.prunedResources) ? result.prunedResources : [];
  const unexpectedPrunedResources = prunedResources.filter(
    (entry) => typeof entry !== 'string' || !isPrunedAcpPath(entry)
  );
  if (unexpectedPrunedResources.length > 0) {
    missing.push(`unexpected non-ACP managed-resource prune(s): ${unexpectedPrunedResources.join(', ')}`);
  }

  requireNoAcpManagedResources(runtimeDir, manifest, missing);
}

function isMachOExecutable(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return isMachOFile(filePath);
  } catch {
    return false;
  }
}

function isMachOFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const header = fs.readFileSync(filePath, { encoding: null, flag: 'r' }).subarray(0, 4).toString('hex');
    return MACHO_MAGICS.has(header);
  } catch {
    return false;
  }
}

function requireMachOExecutable(filePath, relativePath) {
  if (isMachOExecutable(filePath)) return;
  throw new Error(
    `Release macOS bridge resource must be a native Mach-O executable, not a script/fallback wrapper: ${relativePath}`
  );
}

function requireManagedNodeRuntime(resourcesDir, runtimeKey, electronPlatformName, missing) {
  const executableParts = getManagedNodeExecutableParts(electronPlatformName);
  const relativePath = path.join('bundled-aioncore', runtimeKey, 'managed-resources', 'node', '*', ...executableParts);
  const nodeRoot = path.join(resourcesDir, 'bundled-aioncore', runtimeKey, 'managed-resources', 'node');
  if (!fs.existsSync(nodeRoot)) {
    missing.push(relativePath);
    return;
  }

  const versions = fs
    .readdirSync(nodeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const hasExecutable = versions.some((version) => {
    const executablePath = path.join(nodeRoot, version, ...executableParts);
    return fs.existsSync(executablePath);
  });
  if (!hasExecutable) {
    missing.push(relativePath);
  }
}

const PYTHON_RUNTIME_SOURCE_SHA256_BY_ARCH = {
  arm64: '5a30271f8d345a5b02b0c9e4e31e0f1e1455a8e4a04fba95cd9762472abc3b17',
  x64: 'cd369e76973c3179bc578230d8615ab621968ed758c5e32f636eecef4ad79894',
};
const PYTHON_RUNTIME_SOURCE_URL_BY_ARCH = {
  arm64:
    'https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.12.13+20260510-aarch64-apple-darwin-install_only.tar.gz',
  x64: 'https://github.com/astral-sh/python-build-standalone/releases/download/20260510/cpython-3.12.13+20260510-x86_64-apple-darwin-install_only.tar.gz',
};
const PYTHON_RUNTIME_LICENSE_SHA256 = '3b2f81fe21d181c499c59a256c8e1968455d6689d269aa85373bfb6af41da3bf';
const PYTHON_RUNTIME_PACKAGES = [
  ['pyobjc-core', '12.2.1', 'a64232bb27ed101d4adc7d42b0e64a6d3331aac7bee7861c037a6777a163f10b'],
  ['pyobjc-framework-Cocoa', '12.2.1', '28b9b8bab1c36efb94744786918752d0c1842f5fbb67e7d5ca97b5f736512080'],
  ['pyobjc-framework-Quartz', '12.2.1', 'de9c8cca7e95290c8d540466af11c7cdfe3a5458e6f56c34006d5b45243f9ed9'],
  [
    'pyobjc-framework-ApplicationServices',
    '12.2.1',
    'f519ced13888d03410cd7da1f08fc56ee2944099e607216cef7ca26ecfdef61b',
  ],
  ['pyobjc-framework-CoreText', '12.2.1', 'ac2ead13dfa4379a1566129d0e8a8ea778a2bcac9ac360a583360fd4f1ba39c6'],
].map(([name, version, sha256]) => ({ name, version, sha256 }));

function thinMachOArchitecture(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 8).toString('hex');
  if (header.startsWith('cffaedfe0c000001')) return 'arm64';
  if (header.startsWith('cffaedfe07000001')) return 'x64';
  return undefined;
}

function readUInt32(buffer, offset, byteOrder) {
  return byteOrder === 'little' ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function thinMachOCpuType(buffer) {
  if (buffer.length < 8) return undefined;
  const magic = buffer.subarray(0, 4).toString('hex');
  if (magic === 'cffaedfe' || magic === 'cefaedfe') return buffer.readUInt32LE(4);
  if (magic === 'feedfacf' || magic === 'feedface') return buffer.readUInt32BE(4);
  return undefined;
}

function machOContainsArchitecture(filePath, targetArch) {
  const expectedCpuType = targetArch === 'arm64' ? 0x0100000c : targetArch === 'x64' ? 0x01000007 : undefined;
  if (!expectedCpuType) return false;
  const buffer = fs.readFileSync(filePath);
  const thinCpuType = thinMachOCpuType(buffer);
  if (thinCpuType !== undefined) return thinCpuType === expectedCpuType;
  if (buffer.length < 8) return false;

  const magic = buffer.subarray(0, 4).toString('hex');
  const fatShape = {
    cafebabe: { byteOrder: 'big', recordSize: 20, fat64: false },
    bebafeca: { byteOrder: 'little', recordSize: 20, fat64: false },
    cafebabf: { byteOrder: 'big', recordSize: 32, fat64: true },
    bfbafeca: { byteOrder: 'little', recordSize: 32, fat64: true },
  }[magic];
  if (!fatShape) return false;

  const count = readUInt32(buffer, 4, fatShape.byteOrder);
  if (count === 0 || count > 64 || 8 + count * fatShape.recordSize > buffer.length) return false;
  for (let index = 0; index < count; index += 1) {
    const recordOffset = 8 + index * fatShape.recordSize;
    const cpuType = readUInt32(buffer, recordOffset, fatShape.byteOrder);
    if (cpuType !== expectedCpuType) continue;
    const sliceOffset = fatShape.fat64
      ? Number(
          fatShape.byteOrder === 'little'
            ? buffer.readBigUInt64LE(recordOffset + 8)
            : buffer.readBigUInt64BE(recordOffset + 8)
        )
      : readUInt32(buffer, recordOffset + 8, fatShape.byteOrder);
    const sliceSize = fatShape.fat64
      ? Number(
          fatShape.byteOrder === 'little'
            ? buffer.readBigUInt64LE(recordOffset + 16)
            : buffer.readBigUInt64BE(recordOffset + 16)
        )
      : readUInt32(buffer, recordOffset + 12, fatShape.byteOrder);
    if (sliceSize >= 8 && sliceOffset + sliceSize <= buffer.length) {
      return thinMachOCpuType(buffer.subarray(sliceOffset, sliceOffset + sliceSize)) === expectedCpuType;
    }
  }
  return false;
}

function verifyPythonMachOClosureArchitecture(pythonRuntimeDir, targetArch) {
  const pending = [pythonRuntimeDir];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && isMachOFile(entryPath)) {
        if (!machOContainsArchitecture(entryPath, targetArch)) {
          throw new Error(
            `Packaged evaOS desktop bridge Python native runtime does not contain target architecture ${targetArch}: ${entryPath}`
          );
        }
      }
    }
  }
}

function verifyEvaosDesktopBridgeResource(resourcesDir, electronPlatformName, targetArch) {
  if (electronPlatformName !== 'darwin') return;

  const bridgePath = path.join(resourcesDir, 'Bridge', 'evaos-desktop-bridge');
  const peekabooPath = path.join(resourcesDir, 'Bridge', 'bin', 'peekaboo');
  const helperPath = path.join(resourcesDir, 'Bridge', 'bin', 'evaos-connector-helper');
  const manifestPath = path.join(resourcesDir, 'Bridge', 'manifest.json');
  const pythonPath = path.join(resourcesDir, 'Bridge', 'python', 'bin', 'python3');
  const versionedPythonPath = path.join(resourcesDir, 'Bridge', 'python', 'bin', 'python3.12');
  const pythonLicensePath = path.join(resourcesDir, 'Bridge', 'licenses', 'CPython-LICENSE.txt');
  const missing = [];
  if (!fs.existsSync(bridgePath)) {
    missing.push(path.join('Bridge', 'evaos-desktop-bridge'));
  } else {
    try {
      fs.accessSync(bridgePath, fs.constants.X_OK);
    } catch {
      throw new Error(`Packaged evaOS desktop bridge is not executable: ${bridgePath}`);
    }
  }
  if (!fs.existsSync(peekabooPath)) {
    missing.push(path.join('Bridge', 'bin', 'peekaboo'));
  } else {
    try {
      fs.accessSync(peekabooPath, fs.constants.X_OK);
    } catch {
      throw new Error(`Packaged evaOS connector binary is not executable: ${peekabooPath}`);
    }
  }
  if (!fs.existsSync(helperPath)) {
    missing.push(path.join('Bridge', 'bin', 'evaos-connector-helper'));
  } else {
    try {
      fs.accessSync(helperPath, fs.constants.X_OK);
    } catch {
      throw new Error(`Packaged evaOS connector helper is not executable: ${helperPath}`);
    }
  }
  if (!fs.existsSync(manifestPath)) {
    missing.push(path.join('Bridge', 'manifest.json'));
  }
  if (!fs.existsSync(pythonPath)) {
    missing.push(path.join('Bridge', 'python', 'bin', 'python3'));
  } else {
    try {
      fs.accessSync(pythonPath, fs.constants.X_OK);
    } catch {
      throw new Error(`Packaged evaOS desktop bridge Python runtime is not executable: ${pythonPath}`);
    }
  }
  if (!fs.existsSync(versionedPythonPath)) {
    missing.push(path.join('Bridge', 'python', 'bin', 'python3.12'));
  } else {
    try {
      fs.accessSync(versionedPythonPath, fs.constants.X_OK);
    } catch {
      throw new Error(`Packaged evaOS desktop bridge Python runtime is not executable: ${versionedPythonPath}`);
    }
  }
  if (!fs.existsSync(pythonLicensePath)) {
    missing.push(path.join('Bridge', 'licenses', 'CPython-LICENSE.txt'));
  }
  if (missing.length > 0) {
    throw new Error(`Packaged app is missing required evaOS desktop bridge resource(s): ${missing.join(', ')}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const strictReleaseBridge =
    isTruthy(process.env.EVAOS_DESKTOP_BRIDGE_REQUIRE_REAL) ||
    isTruthy(process.env.EVAOS_BETA_PUBLIC_RELEASE) ||
    isTruthy(process.env.EVAOS_BETA_REQUIRE_SIGNING);
  if (strictReleaseBridge && manifest.placeholder === true) {
    throw new Error('Packaged evaOS desktop bridge is a diagnostic placeholder; release builds require a real bridge.');
  }
  if (strictReleaseBridge) {
    if (!targetArch || !PYTHON_RUNTIME_SOURCE_SHA256_BY_ARCH[targetArch]) {
      throw new Error('Packaged evaOS desktop bridge target architecture is required for strict release validation.');
    }
    requireMachOExecutable(peekabooPath, path.join('Bridge', 'bin', 'peekaboo'));
    requireMachOExecutable(helperPath, path.join('Bridge', 'bin', 'evaos-connector-helper'));
    requireMachOExecutable(pythonPath, path.join('Bridge', 'python', 'bin', 'python3'));
    requireMachOExecutable(versionedPythonPath, path.join('Bridge', 'python', 'bin', 'python3.12'));
    const pythonMetadata = manifest.bundledTools?.python;
    if (
      !pythonMetadata?.version ||
      !/^[0-9a-f]{64}$/i.test(String(pythonMetadata.sourceSha256 || '')) ||
      pythonMetadata.license !== 'Python-2.0' ||
      pythonMetadata.licensePath !== 'licenses/CPython-LICENSE.txt' ||
      pythonMetadata.licenseSha256 !== PYTHON_RUNTIME_LICENSE_SHA256 ||
      crypto.createHash('sha256').update(fs.readFileSync(pythonLicensePath)).digest('hex') !==
        PYTHON_RUNTIME_LICENSE_SHA256 ||
      JSON.stringify(pythonMetadata.packages) !== JSON.stringify(PYTHON_RUNTIME_PACKAGES)
    ) {
      throw new Error('Packaged evaOS desktop bridge manifest is missing pinned bundled Python runtime provenance.');
    }
    const expectedDigest = PYTHON_RUNTIME_SOURCE_SHA256_BY_ARCH[targetArch];
    if (
      pythonMetadata.architecture !== targetArch ||
      pythonMetadata.sourceSha256 !== expectedDigest ||
      thinMachOArchitecture(versionedPythonPath) !== targetArch
    ) {
      throw new Error(`Packaged evaOS desktop bridge Python runtime does not match target architecture ${targetArch}.`);
    }
    if (pythonMetadata.sourceUrl !== PYTHON_RUNTIME_SOURCE_URL_BY_ARCH[targetArch]) {
      throw new Error('Packaged evaOS desktop bridge manifest is missing pinned bundled Python runtime provenance.');
    }
    verifyPythonMachOClosureArchitecture(path.join(resourcesDir, 'Bridge', 'python'), targetArch);
    const pythonLink = fs.lstatSync(pythonPath);
    if (!pythonLink.isSymbolicLink() || fs.readlinkSync(pythonPath) !== 'python3.12') {
      throw new Error('Packaged evaOS desktop bridge Python launcher symlink is not relocatable.');
    }
  }

  console.log('   ✓ evaOS desktop bridge resource verified');
}

function verifyBundledResources(resourcesDir, electronPlatformName, targetArch) {
  const runtimeKey = `${electronPlatformName}-${targetArch}`;
  const runtimeDir = path.join(resourcesDir, 'bundled-aioncore', runtimeKey);
  const manifestPath = path.join(runtimeDir, 'manifest.json');
  const missing = [];

  requirePackagedResource(
    resourcesDir,
    path.join('bundled-aioncore', runtimeKey, getBackendBinaryName(electronPlatformName)),
    missing
  );
  requirePackagedResource(resourcesDir, path.join('bundled-aioncore', runtimeKey, 'manifest.json'), missing);
  requirePackagedResource(resourcesDir, path.join('bundled-aioncore', runtimeKey, 'managed-resources'), missing);
  requireManagedNodeRuntime(resourcesDir, runtimeKey, electronPlatformName, missing);

  if (missing.length === 0) {
    const manifest = readJsonFile(manifestPath);
    verifyManagedResourcesBundleManifest(runtimeDir, manifest, missing);
    if (manifest.managedResourcesBundle === 'no-acp') {
      console.log('   ✓ AionCore managed resources bundle: no-acp');
    }
  }

  if (missing.length > 0) {
    throw new Error(`Packaged app is missing required resource(s): ${missing.join(', ')}`);
  }

  console.log(`   ✓ Bundled resources verified for ${runtimeKey}`);
}

module.exports = async function afterPack(context) {
  const { arch, electronPlatformName, appOutDir, packager } = context;
  const targetArch = normalizeArch(typeof arch === 'string' ? arch : Arch[arch] || process.arch);
  const buildArch = normalizeArch(os.arch());
  clearCompletedAfterPack(appOutDir);

  console.log(`\n🔧 afterPack hook started`);
  console.log(`   Platform: ${electronPlatformName}, Build arch: ${buildArch}, Target arch: ${targetArch}`);

  const isCrossCompile = buildArch !== targetArch;
  const forceRebuild = process.env.FORCE_NATIVE_REBUILD === 'true';
  const needsSameArchRebuild = electronPlatformName === 'win32'; // 只有 Windows 需要同架构重建以匹配 Electron ABI | Only Windows needs same-arch rebuild to match Electron ABI
  // Linux 使用预编译二进制，避免 GLIBC 版本依赖 | Linux uses prebuilt binaries which are GLIBC-independent

  const resourcesDir = resolveResourcesDir(electronPlatformName, appOutDir, packager);
  console.log(`   Checking resources directory: ${resourcesDir}`);
  if (fs.existsSync(resourcesDir)) {
    const resourcesContents = fs.readdirSync(resourcesDir);
    console.log(`   Contents: ${resourcesContents.join(', ')}`);

    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
    if (fs.existsSync(unpackedDir)) {
      const unpackedContents = fs.readdirSync(unpackedDir);
      console.log(`   app.asar.unpacked contents: ${unpackedContents.join(', ')}`);

      const nodeModulesDir = path.join(unpackedDir, 'node_modules');
      if (fs.existsSync(nodeModulesDir)) {
        const modulesContents = fs.readdirSync(nodeModulesDir);
        console.log(`   node_modules contents: ${modulesContents.slice(0, 10).join(', ')}...`);
      } else {
        console.warn(`   ⚠️  node_modules not found in app.asar.unpacked`);
      }
    } else {
      console.warn(`   ⚠️  app.asar.unpacked not found`);
    }

    verifyBundledResources(resourcesDir, electronPlatformName, targetArch);
    verifyEvaosDesktopBridgeResource(resourcesDir, electronPlatformName, targetArch);
  } else {
    throw new Error(`resources directory not found: ${resourcesDir}`);
  }

  if (!isCrossCompile && !needsSameArchRebuild && !forceRebuild) {
    markCompletedAfterPack(appOutDir);
    console.log(`   ✓ Same architecture, rebuild skipped (set FORCE_NATIVE_REBUILD=true to override)\n`);
    return;
  }

  // Note: Previously there was an optimization to skip macOS cross-compilation,
  // but this caused incorrect architecture binaries (arm64) to be included in x64 builds.
  // Now we always rebuild native modules for cross-compilation to ensure correctness.
  // The rebuild process uses prebuild-install first (fast), falling back to source compilation only when needed.

  if (isCrossCompile) {
    console.log(`   ⚠️  Cross-compilation detected (${buildArch} → ${targetArch}), will rebuild native modules`);
    if (electronPlatformName === 'darwin') {
      console.log(`   💡 Using prebuild-install for faster cross-architecture build`);
    }
  } else if (needsSameArchRebuild || forceRebuild) {
    console.log(`   ℹ️  Rebuilding native modules for platform requirements (force=${forceRebuild})`);
  }

  console.log(`\n🔧 Checking native modules (${electronPlatformName}-${targetArch})...`);
  console.log(`   appOutDir: ${appOutDir}`);

  const electronVersion =
    packager?.info?.electronVersion ??
    packager?.config?.electronVersion ??
    require('../package.json').devDependencies?.electron?.replace(/^\D*/, '');

  const nodeModulesDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');

  // Modules that need to be rebuilt for cross-compilation
  // Use platform-specific module list (Windows skips node-pty due to cross-compilation issues)
  const modulesToRebuild = getModulesToRebuild(electronPlatformName);
  console.log(`   Modules to rebuild: ${modulesToRebuild.join(', ')}`);

  // For cross-compilation, clean up build artifacts from the wrong architecture
  // This prevents node-gyp-build from loading incorrect binaries
  if (isCrossCompile) {
    console.log(`\n🧹 Cleaning up wrong-architecture build artifacts...`);
    for (const moduleName of modulesToRebuild) {
      const moduleRoot = path.join(nodeModulesDir, moduleName);
      if (!fs.existsSync(moduleRoot)) continue;

      // Remove build/ directory (contains wrong-arch compiled binaries)
      const buildDir = path.join(moduleRoot, 'build');
      if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/build/`);
      }

      // Remove bin/ directory (might contain wrong-arch binaries)
      const binDir = path.join(moduleRoot, 'bin');
      if (fs.existsSync(binDir)) {
        fs.rmSync(binDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/bin/`);
      }
    }

    // Also clean up architecture-specific packages that shouldn't be included
    // Remove packages for the opposite architecture of the target
    const wrongArchSuffix = targetArch === 'arm64' ? 'x64' : 'arm64';
    console.log(`\n🧹 Removing ${wrongArchSuffix}-specific optional dependencies (target: ${targetArch})...`);

    if (fs.existsSync(nodeModulesDir)) {
      const allModules = fs.readdirSync(nodeModulesDir);
      for (const module of allModules) {
        const modulePath = path.join(nodeModulesDir, module);

        // Handle scoped packages (e.g., @lydell, @napi-rs)
        if (module.startsWith('@') && fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
          const scopedPackages = fs.readdirSync(modulePath);
          for (const pkg of scopedPackages) {
            if (pkg.includes(`-${wrongArchSuffix}`) || pkg.includes(`-${electronPlatformName}-${wrongArchSuffix}`)) {
              const pkgPath = path.join(modulePath, pkg);
              if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).isDirectory()) {
                fs.rmSync(pkgPath, { recursive: true, force: true });
                console.log(`   ✓ Removed ${module}/${pkg}`);
              }
            }
          }
        }
        // Handle regular packages
        else if (
          module.includes(`-${wrongArchSuffix}`) ||
          module.includes(`-${electronPlatformName}-${wrongArchSuffix}`)
        ) {
          if (fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
            fs.rmSync(modulePath, { recursive: true, force: true });
            console.log(`   ✓ Removed ${module}`);
          }
        }
      }
    }
  }

  const failedModules = [];

  for (const moduleName of modulesToRebuild) {
    const moduleRoot = path.join(nodeModulesDir, moduleName);

    if (!fs.existsSync(moduleRoot)) {
      console.warn(`   ⚠️  ${moduleName} not found, skipping`);
      continue;
    }

    console.log(`   ✓ Found ${moduleName}, rebuilding for ${targetArch}...`);

    // For Windows, prefer prebuild-install first (faster and more reliable in CI)
    // electron-rebuild can hang on "Searching dependency tree" in some CI environments
    // prebuild-install will fall back to electron-rebuild internally if no prebuilt binary exists
    const forceRebuildFromSource = false; // Always try prebuild-install first

    const success = rebuildSingleModule({
      moduleName,
      moduleRoot,
      platform: electronPlatformName,
      arch: targetArch,
      electronVersion,
      projectRoot: path.resolve(__dirname, '..'),
      buildArch: buildArch, // Pass build architecture for cross-compile detection
      forceRebuild: forceRebuildFromSource, // Always try prebuild-install first, fallback to rebuild
    });

    if (success) {
      console.log(`     ✓ Rebuild completed`);
    } else {
      console.error(`     ✗ Rebuild failed`);
      failedModules.push(moduleName);
      continue;
    }

    const verified = verifyModuleBinary(moduleRoot, moduleName);
    if (verified) {
      console.log(`     ✓ Binary verification passed`);
    } else {
      console.error(`     ✗ Binary verification failed`);
      failedModules.push(moduleName);
    }

    console.log(''); // Empty line between modules
  }

  if (failedModules.length > 0) {
    throw new Error(`Failed to rebuild modules for ${electronPlatformName}-${targetArch}: ${failedModules.join(', ')}`);
  }

  markCompletedAfterPack(appOutDir);
  console.log(`✅ All native modules rebuilt successfully for ${targetArch}\n`);
};

module.exports.verifyBundledResources = verifyBundledResources;
module.exports.verifyEvaosDesktopBridgeResource = verifyEvaosDesktopBridgeResource;
module.exports.thinMachOArchitecture = thinMachOArchitecture;
module.exports.machOContainsArchitecture = machOContainsArchitecture;
module.exports.isMachOExecutable = isMachOExecutable;
