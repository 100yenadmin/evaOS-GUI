import { startWebHost } from '@aionui/web-host';
import type { WebHostHandle } from '@aionui/web-host';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// tarball layout:
//   aionui-web/
//   ├── bin/aionui-web.js         ← entry
//   ├── dist/index.js             ← this module (after compile)
//   ├── bundled-aionui-backend/<plat-arch>/aionui-backend[.exe]
//   ├── bundled-bun/<plat-arch>/bun[.exe]
//   └── static/                    ← SPA assets
// `__dirname` is either `.../aionui-web/dist` (packaged) or `.../packages/web-cli/src` (dev).
const cliRoot = path.resolve(__dirname, '..');

const BACKEND_BINARY = process.platform === 'win32' ? 'aionui-backend.exe' : 'aionui-backend';
const DEFAULT_PORT = 25808;

let currentHandle: WebHostHandle | null = null;

function parseArgs(argv: string[]): { command: string; flags: Map<string, string | true> } {
  const [command = 'start', ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(name, next);
      i++;
    } else {
      flags.set(name, true);
    }
  }
  return { command, flags };
}

function resolveBackendBinary(flags: Map<string, string | true>): string {
  const override = flags.get('backend-bin');
  if (typeof override === 'string') return path.resolve(override);
  const envOverride = process.env.AIONUI_BACKEND_BIN;
  if (envOverride) return path.resolve(envOverride);
  const platArch = `${process.platform}-${process.arch}`;
  const bundled = path.join(cliRoot, 'bundled-aionui-backend', platArch, BACKEND_BINARY);
  return bundled;
}

function resolveStaticDir(flags: Map<string, string | true>): string {
  const override = flags.get('static-dir');
  if (typeof override === 'string') return path.resolve(override);
  return path.join(cliRoot, 'static');
}

function resolveDataDir(flags: Map<string, string | true>): string {
  const override = flags.get('data-dir');
  if (typeof override === 'string') return path.resolve(override);
  const envOverride = process.env.AIONUI_DATA_DIR;
  if (envOverride) return path.resolve(envOverride);
  return path.join(os.homedir(), '.aionui-web');
}

function resolveLogDir(flags: Map<string, string | true>, dataDir: string): string {
  const override = flags.get('log-dir');
  if (typeof override === 'string') return path.resolve(override);
  const envOverride = process.env.AIONUI_LOG_DIR;
  if (envOverride) return path.resolve(envOverride);
  return path.join(dataDir, 'logs');
}

function resolvePort(flags: Map<string, string | true>): number {
  const cli = flags.get('port');
  if (typeof cli === 'string' && /^\d+$/.test(cli)) return Number(cli);
  const env = process.env.AIONUI_PORT ?? process.env.PORT;
  if (env && /^\d+$/.test(env)) return Number(env);
  return DEFAULT_PORT;
}

function resolveAllowRemote(flags: Map<string, string | true>): boolean {
  if (flags.has('remote')) return true;
  const env = process.env.AIONUI_ALLOW_REMOTE ?? process.env.AIONUI_REMOTE;
  if (!env) return false;
  return ['1', 'true', 'yes', 'on'].includes(env.trim().toLowerCase());
}

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(cliRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function runStart(flags: Map<string, string | true>): Promise<void> {
  const backendBin = resolveBackendBinary(flags);
  const staticDir = resolveStaticDir(flags);
  const dataDir = resolveDataDir(flags);
  fs.mkdirSync(dataDir, { recursive: true });
  const logDir = resolveLogDir(flags, dataDir);
  fs.mkdirSync(logDir, { recursive: true });
  const port = resolvePort(flags);
  const allowRemote = resolveAllowRemote(flags);
  const version = readPackageVersion();

  if (!fs.existsSync(backendBin)) {
    console.error(`[aionui-web] backend binary not found: ${backendBin}`);
    console.error(`  hint: set AIONUI_BACKEND_BIN or pass --backend-bin <path>`);
    process.exit(1);
  }
  if (!fs.existsSync(staticDir)) {
    console.error(`[aionui-web] static dir not found: ${staticDir}`);
    console.error(`  hint: pass --static-dir <path> pointing to the SPA build output`);
    process.exit(1);
  }

  console.log(`[aionui-web] version    : ${version}`);
  console.log(`[aionui-web] data dir   : ${dataDir}`);
  console.log(`[aionui-web] log dir    : ${logDir}`);
  console.log(`[aionui-web] static dir : ${staticDir}`);
  console.log(`[aionui-web] backend bin: ${backendBin}`);
  console.log(`[aionui-web] launching  : port=${port} allowRemote=${allowRemote}`);

  const handle = await startWebHost({
    app: {
      version,
      isPackaged: true,
      resourcesPath: cliRoot,
      userDataPath: dataDir,
    },
    staticDir,
    port,
    allowRemote,
    dataDir,
    logDir,
    dirs: {
      cacheDir: dataDir,
      workDir: dataDir,
      logDir,
    },
    backend: {
      kind: 'ownBackend',
      resolveBackend: () => backendBin,
    },
  });

  currentHandle = handle;

  console.log('');
  console.log('AionUi WebUI is ready');
  console.log(`  Local  : ${handle.localUrl}`);
  if (handle.networkUrl) console.log(`  Network: ${handle.networkUrl}`);
  if (handle.initialPassword) {
    console.log('');
    console.log(`Initial admin password: ${handle.initialPassword}`);
    console.log('(change it after first login)');
  }
  console.log('');
  console.log('Press Ctrl+C to stop.');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[aionui-web] received ${signal}, stopping...`);
    try {
      await handle.stop();
    } catch (err) {
      console.error('[aionui-web] stop failed:', err);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === '--version' || command === 'version' || command === '-v') {
    console.log(readPackageVersion());
    return;
  }

  if (command === '--help' || command === 'help' || command === '-h') {
    console.log(`Usage: aionui-web <command> [options]

Commands:
  start              Start the WebUI (default)
  version            Print version
  help               Show this help

Options for start:
  --port <n>              Listen port (default: ${DEFAULT_PORT})
  --remote                Bind 0.0.0.0 instead of 127.0.0.1
  --data-dir <path>       Override data dir (default: ~/.aionui-web)
  --log-dir <path>        Override log dir (default: <data-dir>/logs)
  --static-dir <path>     Override static assets dir
  --backend-bin <path>    Override backend binary path

Environment variables:
  AIONUI_PORT, AIONUI_ALLOW_REMOTE, AIONUI_DATA_DIR, AIONUI_LOG_DIR,
  AIONUI_BACKEND_BIN
`);
    return;
  }

  if (command !== 'start') {
    console.error(`Unknown command: ${command}`);
    console.error('Usage: aionui-web [start|version|help]');
    process.exit(1);
  }

  await runStart(flags);
}

main().catch((err: Error) => {
  console.error('[aionui-web] fatal:', err.message);
  if (currentHandle) void currentHandle.stop().catch(() => undefined);
  process.exit(1);
});
