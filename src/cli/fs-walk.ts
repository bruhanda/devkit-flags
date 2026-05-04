import { detectRuntime } from '../utils/runtime.js';

interface WalkOptions {
  /** Glob-like pattern. Default: `**\/*.{ts,tsx,js,jsx}`. */
  readonly pattern?: string;
  /** Skip these directories (any segment match). */
  readonly skipDirs?: readonly string[];
}

const DEFAULT_SKIP_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.svelte-kit',
  '.wrangler',
  '.vercel',
];

const DEFAULT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Yield every source file under `root` that matches the pattern.
 * Pure async generator — no concurrency boundaries. Uses
 * `node:fs/promises.readdir` via dynamic import; throws on
 * non-Node-like runtimes.
 *
 * @param root  Filesystem path to walk.
 * @param opts  Pattern + skip-dirs overrides.
 * @returns     Async iterable of absolute paths.
 */
export async function* walkSources(
  root: string,
  opts?: WalkOptions,
): AsyncGenerator<string> {
  const runtime = detectRuntime();
  if (runtime !== 'node' && runtime !== 'bun') {
    throw new Error('walkSources is only supported on Node.js / Bun');
  }
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const skip = new Set([...DEFAULT_SKIP_DIRS, ...(opts?.skipDirs ?? [])]);
  yield* walk(fs, path, root, skip);
}

async function* walk(
  fs: typeof import('node:fs/promises'),
  path: typeof import('node:path'),
  current: string,
  skip: Set<string>,
): AsyncGenerator<string> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = (await fs.readdir(current, {
      withFileTypes: true,
      encoding: 'utf8',
    })) as unknown as Array<{ name: string; isDirectory: () => boolean }>;
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (skip.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fs, path, full, skip);
      continue;
    }
    const ext = path.extname(entry.name);
    if (DEFAULT_EXTENSIONS.has(ext)) {
      yield full;
    }
  }
}
