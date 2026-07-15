declare module 'openclaw/plugin-sdk/plugin-entry' {
  export function definePluginEntry(entry: unknown): unknown;
}

declare module 'node:child_process' {
  export function execFile(...args: unknown[]): unknown;
}

declare module 'node:crypto' {
  export function createHash(algorithm: string): {
    update(value: unknown): {
      digest(): EvaosBuffer;
      digest(encoding: string): string;
    };
  };
  export function createPublicKey(options: unknown): unknown;
  export function createHmac(...args: unknown[]): { update(value: unknown): { digest(encoding: string): string } };
  export function randomUUID(): string;
  export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean;
  export function verify(algorithm: null, data: unknown, key: unknown, signature: unknown): boolean;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
}

declare module 'node:util' {
  export function promisify(fn: unknown): (...args: unknown[]) => Promise<unknown>;
}

declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function writeFile(path: string, data: unknown, options?: { encoding?: string; mode?: number }): Promise<void>;
}

declare module 'node:path' {
  const path: {
    join(...parts: string[]): string;
    dirname(value: string): string;
  };
  export default path;
}

declare const process: {
  env: Record<string, string | undefined>;
};

type EvaosBuffer = Uint8Array & {
  readUInt32BE(offset: number): number;
  writeUInt32BE(value: number, offset: number): number;
  toString(encoding?: string): string;
};

declare const Buffer: {
  from(value: string | ArrayBuffer | Uint8Array | readonly number[], encoding?: string): EvaosBuffer;
  alloc(size: number): EvaosBuffer;
  concat(values: readonly Uint8Array[]): EvaosBuffer;
  isBuffer(value: unknown): boolean;
};
