import type { WebHostOptions, WebHostHandle } from './types.js';

export type { AppMetadata, BackendBinaryResolver, WebHostOptions, WebHostHandle, WebUIConfig } from './types.js';
export { resetPassword, changePassword, verifyPassword, loadConfig, saveConfig } from './auth/index.js';
export { startStaticServer, stopStaticServer } from './static-server.js';
export type { StaticServerOptions, StaticServerHandle } from './static-server.js';
export { SESSION_COOKIE } from './auth/session.js';
export { RateLimiter, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS } from './auth/rateLimiter.js';

// Backend launcher exports (M4)
export {
  BackendLifecycleManager,
  buildSpawnArgs,
  buildSpawnEnv,
  findAvailablePort,
  startBackend,
  stopBackend,
} from './backend-launcher.js';
export type {
  BackendDirConfig,
  BackendLaunchOptions,
  BackendHandle,
} from './backend-launcher.js';

/**
 * Start WebHost (main entry point)
 * M5: implementation will orchestrate backend-launcher + static-server + auth
 */
export async function startWebHost(opts: WebHostOptions): Promise<WebHostHandle> {
  throw new Error('M5: startWebHost not implemented yet');
}
