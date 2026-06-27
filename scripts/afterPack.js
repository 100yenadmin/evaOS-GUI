const { Arch } = require('builder-util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  normalizeArch,
  rebuildSingleModule,
  verifyModuleBinary,
  getModulesToRebuild,
} = require('./rebuildNativeModules');
const { assertNonFullProfileNotRelease, readPackagingProfile } = require('./packagingProfile');
const { normalizeManagedResourcesBundle } = require('../packages/shared-scripts/src/prepare-aioncore.js');

/**
 * afterPack hook for electron-builder
 * Rebuilds native modules for cross-architecture builds
 */

function resolveResourcesDir(electronPlatformName, appOutDir, packager) {
  if (electronPlatformName !== 'darwin') return path.join(appOutDir, 'resources');

  const appName = packager?.appInfo?.productFilename || 'AionUi';
  return path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
}

function getBackendBinaryName(electronPlatformName) {
  return electronPlatformName === 'win32' ? 'aioncore.exe' : 'aioncore';
}

function requirePackagedResource(resourcesDir, relativePath, missing) {
  const absolutePath = path.join(resourcesDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    missing.push(relativePath);
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
  const hasAcpContext = segments.some((segment) => {
    const normalized = segment.toLowerCase().replace(/[_-]/g, '');
    return normalized === 'acp' || normalized === 'acpadapter' || normalized === 'acpadapters';
  });
  const hasClaudeOrCodex = segments.some((segment) => {
    const stem = segment.toLowerCase().replace(/\.[^.]+$/, '');
    return /(^|[-_])(?:claude|codex)(?:$|[-_])/i.test(stem);
  });
  return hasAcpContext && hasClaudeOrCodex;
}

function isEntryCoveredByPrune(entry, pruneEntry) {
  const normalizedEntry = normalizeResourceEntry(entry);
  const normalizedPrune = normalizeResourceEntry(pruneEntry);
  if (normalizedEntry === normalizedPrune) return true;
  return normalizedPrune.endsWith('/') && normalizedEntry.startsWith(normalizedPrune);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Packaged app has unreadable AionCore manifest: ${filePath} (${error.message})`);
  }
}

function verifyHubResources(resourcesDir, missing) {
  const hubDir = path.join(resourcesDir, 'hub');
  requirePackagedResource(resourcesDir, path.join('hub', 'index.json'), missing);
  requirePackagedResource(resourcesDir, path.join('hub', 'manifest.json'), missing);
  try {
    const hasZip = fs.readdirSync(hubDir).some((entry) => entry.endsWith('.zip'));
    if (!hasZip) missing.push(path.join('hub', '*.zip'));
  } catch {
    missing.push('hub/');
  }
}

function requireManifestResourceShape(runtimeDir, manifest, key, missing) {
  const shape = manifest?.resourceShape?.[key];
  if (!shape?.present) return;
  const relativePath = shape.relativePath;
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    missing.push(`manifest resourceShape.${key}.relativePath`);
    return;
  }

  const absolutePath = path.join(runtimeDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    missing.push(path.join('bundled-aioncore', manifest.runtimeKey || path.basename(runtimeDir), relativePath));
  }
}

function requireManagedNodePreserved(runtimeDir, manifest, missing) {
  const sourceManagedNode = manifest?.sourceResourceShape?.managedNodeRuntime;
  if (sourceManagedNode?.present !== true) return;
  const finalManagedNode = manifest?.resourceShape?.managedNodeRuntime;
  if (finalManagedNode?.present !== true) {
    missing.push('managed Node runtime removed by AIONUI_MANAGED_RESOURCES_BUNDLE');
    return;
  }
  requireManifestResourceShape(runtimeDir, manifest, 'managedNodeRuntime', missing);
}

function requireManagedResourceInventory(runtimeDir, result, missing) {
  if (!result?.managedResourcesPath) return;
  const sourceResources = Array.isArray(result.sourceResources) ? result.sourceResources : null;
  const keptResources = Array.isArray(result.keptResources) ? result.keptResources : null;
  const prunedResources = Array.isArray(result.prunedResources) ? result.prunedResources : [];

  if (!sourceResources || !keptResources) {
    missing.push('manifest managedResourcesBundleResult resource inventory');
    return;
  }

  const keptSet = new Set(keptResources.map(normalizeResourceEntry));
  for (const sourceEntry of sourceResources.map(normalizeResourceEntry)) {
    if (keptSet.has(sourceEntry)) continue;
    if (prunedResources.some((prunedEntry) => isEntryCoveredByPrune(sourceEntry, prunedEntry))) continue;
    missing.push(`unexpected managed-resource loss: ${sourceEntry}`);
  }

  const managedResourcesDir = path.join(runtimeDir, result.managedResourcesPath);
  for (const keptEntry of keptSet) {
    const relativeEntry = keptEntry.endsWith('/') ? keptEntry.slice(0, -1) : keptEntry;
    if (!fs.existsSync(path.join(managedResourcesDir, relativeEntry))) {
      missing.push(
        path.join('bundled-aioncore', path.basename(runtimeDir), result.managedResourcesPath, relativeEntry)
      );
    }
  }
}

function verifyManagedResourcesBundleManifest(runtimeDir, manifest, missing) {
  const bundleMode = manifest?.managedResourcesBundle;
  if (bundleMode == null) {
    missing.push('manifest managedResourcesBundle');
    return;
  }
  normalizeManagedResourcesBundle(bundleMode);

  const result = manifest?.managedResourcesBundleResult;
  if (bundleMode === 'no-acp') {
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
    requireManagedResourceInventory(runtimeDir, result, missing);
  }

  requireManagedNodePreserved(runtimeDir, manifest, missing);
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
  requirePackagedResource(resourcesDir, 'hub', missing);
  verifyHubResources(resourcesDir, missing);

  if (missing.length === 0) {
    const manifest = readJsonFile(manifestPath);
    verifyManagedResourcesBundleManifest(runtimeDir, manifest, missing);
    requireManifestResourceShape(runtimeDir, manifest, 'managedResources', missing);
    requireManifestResourceShape(runtimeDir, manifest, 'managedNodeRuntime', missing);
    if (manifest.managedResourcesBundle === 'no-acp') {
      console.log('   ✓ AionCore managed resources bundle: no-acp');
    }
  }

  if (missing.length > 0) {
    throw new Error(`Packaged app is missing required resource(s): ${missing.join(', ')}`);
  }

  console.log(`   ✓ Bundled resources verified for ${runtimeKey}`);
}

/**
 * electron-builder afterPack hook.
 *
 * @param {{arch: string|number, electronPlatformName: string, appOutDir: string, packager?: object}} context - Build context from electron-builder.
 * @returns {Promise<void>} Resolves after resource verification and any native-module rebuilds complete.
 *
 * The hook reads EVAOS_PACKAGING_PROFILE from the build environment. `full` and
 * `functional-smoke` must include bundled AionCore and hub resources and fail closed
 * when they are missing. `thin-shell` intentionally skips bundled runtime
 * resource verification because it is a UI/layout smoke artifact only. Non-full
 * profiles are refused when release, signing, notary, or distribution flags are
 * present. Native module rebuild behavior remains unchanged: rebuild when cross
 * compiling, on Windows same-arch packaging, or when FORCE_NATIVE_REBUILD=true.
 */
module.exports = async function afterPack(context) {
  const { arch, electronPlatformName, appOutDir, packager } = context;
  // build-with-builder propagates CLI --packaging-profile into env before electron-builder runs hooks.
  const packagingProfile = readPackagingProfile({ argv: [], env: process.env });
  assertNonFullProfileNotRelease(packagingProfile, { env: process.env, context: 'electron-builder afterPack' });

  const targetArch = normalizeArch(typeof arch === 'string' ? arch : Arch[arch] || process.arch);
  const buildArch = normalizeArch(os.arch());

  console.log(`\n🔧 afterPack hook started`);
  console.log(`   Platform: ${electronPlatformName}, Build arch: ${buildArch}, Target arch: ${targetArch}`);
  console.log(`   Packaging profile: ${packagingProfile}`);

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

    if (packagingProfile === 'thin-shell') {
      console.log('   ✓ thin-shell profile: bundled runtime resource verification intentionally skipped');
    } else {
      verifyBundledResources(resourcesDir, electronPlatformName, targetArch);
    }
  } else {
    throw new Error(`resources directory not found: ${resourcesDir}`);
  }

  if (!isCrossCompile && !needsSameArchRebuild && !forceRebuild) {
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

  console.log(`✅ All native modules rebuilt successfully for ${targetArch}\n`);
};
