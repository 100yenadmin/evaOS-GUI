import { describe, expect, it } from 'vitest';
import { classifyBackendStartupFailure } from '@/process/startup/backendStartupFailure';
import { detectStartupArchitectureMismatch } from '@/process/startup/architectureCompatibility';

describe('classifyBackendStartupFailure', () => {
  it('classifies missing GLIBC symbols as an incompatible backend runtime', () => {
    const error = new Error('aioncore exited before health check passed') as Error & {
      details?: Record<string, unknown>;
    };
    error.details = {
      stage: 'early_exit',
      stderrTail:
        "/opt/AionUi/resources/bundled-aioncore/linux-x64/aioncore.bin: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.34' not found\n" +
        "/opt/AionUi/resources/bundled-aioncore/linux-x64/aioncore.bin: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.32' not found",
    };

    expect(classifyBackendStartupFailure(error)).toEqual({
      reason: 'backend_incompatible_runtime',
      runtime: 'glibc',
      requiredVersions: ['2.32', '2.34'],
    });
  });

  it('keeps unrelated startup failures in the generic bucket', () => {
    const error = new Error('aioncore failed to start within timeout') as Error & {
      details?: Record<string, unknown>;
    };
    error.details = {
      stage: 'health_timeout',
      stderrTail: 'database is locked',
    };

    expect(classifyBackendStartupFailure(error)).toEqual({
      reason: 'backend_startup_failed',
    });
  });

  it('classifies startup directory permission failures separately', () => {
    const error = new Error('aioncore startup directory preparation failed') as Error & {
      details?: Record<string, unknown>;
    };
    error.details = {
      stage: 'spawn',
      causeMessage: 'EACCES: permission denied, mkdir /redacted/work-directory',
    };

    expect(classifyBackendStartupFailure(error)).toEqual({
      reason: 'backend_startup_directory_unavailable',
      startupDirectoryIssueKind: 'permission_denied',
    });
  });

  it('classifies unavailable startup directory preparation separately', () => {
    const error = new Error('aioncore startup directory preparation failed') as Error & {
      details?: Record<string, unknown>;
    };
    error.details = {
      stage: 'spawn',
      causeMessage: 'ENOTDIR: not a directory, mkdir /redacted/work-directory',
    };

    expect(classifyBackendStartupFailure(error)).toEqual({
      reason: 'backend_startup_directory_unavailable',
      startupDirectoryIssueKind: 'missing_or_unavailable_directory',
    });
  });

  it('keeps binary spawn ENOENT in the generic bucket', () => {
    const error = new Error('aioncore process emitted an error before startup') as Error & {
      details?: Record<string, unknown>;
    };
    error.details = {
      stage: 'spawn_error',
      causeMessage: 'spawn aioncore ENOENT',
    };

    expect(classifyBackendStartupFailure(error)).toEqual({
      reason: 'backend_startup_failed',
      backendBoundaryCode: undefined,
      backendBoundaryStage: undefined,
    });
  });

  it('preserves backend bootstrap code and stage for generic startup failures', () => {
    const error = new Error('aioncore exited before health check passed') as Error & {
      details?: Record<string, unknown>;
    };
    error.details = {
      stage: 'early_exit',
      stderrTail: 'BOOTSTRAP_DATA_INIT_FAILED stage=database.open: failed to initialize application data',
      backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
      backendBoundaryStage: 'database.open',
    };

    expect(classifyBackendStartupFailure(error)).toEqual({
      reason: 'backend_startup_failed',
      backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
      backendBoundaryStage: 'database.open',
    });
  });

  it('classifies recoverable database corruption separately from generic startup failures', () => {
    const error = new Error('aioncore exited before health check passed') as Error & {
      details?: Record<string, unknown>;
    };
    error.details = {
      stage: 'early_exit',
      backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
      backendBoundaryStage: 'database.recoverable_corruption',
      stderrTail:
        'BOOTSTRAP_DATA_INIT_FAILED stage=database.recoverable_corruption: local database can be backed up and rebuilt',
    };

    expect(classifyBackendStartupFailure(error)).toEqual({
      reason: 'backend_recoverable_database_corruption',
      backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
      backendBoundaryStage: 'database.recoverable_corruption',
    });
  });

  it('classifies packaged macOS architecture mismatches separately from generic startup failures', () => {
    const error = new Error('evaOS Workbench package architecture does not match this Mac') as Error & {
      details?: Record<string, unknown>;
    };
    error.details = {
      stage: 'startup_architecture_check',
      platform: 'darwin',
      isPackaged: true,
      packageArch: 'x64',
      deviceArch: 'arm64',
      expectedDownloadArch: 'arm64',
      isRosettaTranslated: true,
    };

    expect(classifyBackendStartupFailure(error)).toEqual({
      reason: 'backend_package_architecture_mismatch',
      packageArch: 'x64',
      deviceArch: 'arm64',
      expectedDownloadArch: 'arm64',
      isRosettaTranslated: true,
    });
  });

  it('classifies packaged app resources missing from installation as incomplete installation', () => {
    const error = new Error('aioncore startup failed while resolving backend binary') as Error & {
      details?: Record<string, unknown>;
    };
    error.details = {
      stage: 'resolve_binary',
      isPackaged: true,
      runtimeKey: 'win32-x64',
      binaryName: 'aioncore.exe',
      bundledDirExists: false,
      runtimeDirExists: false,
      resourcesDirEntries: [
        'app-update.yml',
        'app.asar',
        'app.asar.unpacked/',
        'app.png',
        'elevate.exe',
        'manifest.webmanifest',
        'sw.js',
      ],
    };

    expect(classifyBackendStartupFailure(error)).toEqual({
      reason: 'backend_incomplete_installation',
      incompleteInstallationKind: 'missing_directory_resources',
      missingBackendBinary: true,
      missingBundledAioncoreDir: true,
      missingHubDir: true,
      missingPetStatesDir: true,
      missingPwaDir: true,
      missingResources: ['bundled-aioncore/', 'bundled-aioncore/win32-x64/'],
      missingRuntimeDir: true,
    });
  });

  it('classifies packaged runtime directories without the backend binary as incomplete installation', () => {
    const error = new Error('aioncore startup failed while resolving backend binary') as Error & {
      details?: Record<string, unknown>;
    };
    error.details = {
      stage: 'resolve_binary',
      isPackaged: true,
      runtimeKey: 'win32-x64',
      binaryName: 'aioncore.exe',
      bundledDirExists: true,
      runtimeDirExists: true,
      resourcesDirEntries: [
        'app-update.yml',
        'app.asar',
        'app.asar.unpacked/',
        'app.png',
        'bundled-aioncore/',
        'elevate.exe',
        'hub/',
        'manifest.webmanifest',
        'pet-states/',
        'pwa/',
        'sw.js',
      ],
      runtimeDirEntries: ['manifest.json'],
    };

    expect(classifyBackendStartupFailure(error)).toEqual({
      reason: 'backend_incomplete_installation',
      incompleteInstallationKind: 'missing_directory_resources',
      missingBackendBinary: true,
      missingBundledAioncoreDir: false,
      missingHubDir: false,
      missingPetStatesDir: false,
      missingPwaDir: false,
      missingResources: ['bundled-aioncore/win32-x64/managed-resources/', 'bundled-aioncore/win32-x64/aioncore.exe'],
      missingRuntimeDir: false,
    });
  });
});

describe('detectStartupArchitectureMismatch', () => {
  it('detects packaged macOS x64 builds running on Apple Silicon', () => {
    const mismatch = detectStartupArchitectureMismatch({
      arch: 'x64',
      isPackaged: true,
      platform: 'darwin',
      execFileSync: (command, args) => {
        expect(command).toBe('sysctl');
        if (args.join(' ') === '-in sysctl.proc_translated') return '1\n';
        if (args.join(' ') === '-in hw.optional.arm64') return '1\n';
        throw new Error(`unexpected args: ${args.join(' ')}`);
      },
    });

    expect(mismatch).toEqual({
      deviceArch: 'arm64',
      expectedDownloadArch: 'arm64',
      isPackaged: true,
      isRosettaTranslated: true,
      packageArch: 'x64',
      platform: 'darwin',
      stage: 'startup_architecture_check',
    });
  });

  it('allows packaged macOS x64 builds on Intel Macs', () => {
    const mismatch = detectStartupArchitectureMismatch({
      arch: 'x64',
      isPackaged: true,
      platform: 'darwin',
      execFileSync: (_command, args) => {
        if (args.join(' ') === '-in sysctl.proc_translated') return '0\n';
        if (args.join(' ') === '-in hw.optional.arm64') return '0\n';
        throw new Error(`unexpected args: ${args.join(' ')}`);
      },
    });

    expect(mismatch).toBeNull();
  });

  it('skips checks outside packaged macOS', () => {
    const mismatch = detectStartupArchitectureMismatch({
      arch: 'x64',
      isPackaged: false,
      platform: 'darwin',
      execFileSync: () => {
        throw new Error('sysctl should not be called');
      },
    });

    expect(mismatch).toBeNull();
  });
});
