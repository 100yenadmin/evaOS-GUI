declare module 'openclaw/plugin-sdk/plugin-entry' {
  export function definePluginEntry(entry: unknown): unknown;
}

declare module 'node:child_process' {
  export function execFile(...args: unknown[]): unknown;
}

declare module 'node:crypto' {
  export function createPublicKey(options: unknown): unknown;
  export function createHmac(...args: unknown[]): { update(value: unknown): { digest(encoding: string): string } };
  export function randomUUID(): string;
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

declare const Buffer: {
  from(
    value: string | ArrayBuffer | Uint8Array,
    encoding?: string
  ): {
    byteLength: number;
    subarray(start?: number, end?: number): Uint8Array;
    toString(encoding?: string): string;
  };
  concat(values: unknown[]): {
    byteLength: number;
    subarray(start?: number, end?: number): Uint8Array;
    toString(encoding?: string): string;
  };
  isBuffer(value: unknown): boolean;
};
