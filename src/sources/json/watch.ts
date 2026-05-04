import { detectRuntime } from '../../utils/runtime.js';

/**
 * Subscribe to filesystem changes for a single path. Uses
 * `node:fs.watch` via dynamic import so the module never appears in
 * a Workers / Deno Deploy / browser bundle. No-ops on runtimes that
 * cannot watch local files.
 *
 * @param path     Absolute path of the watched file.
 * @param onChange Listener fired on every observed change.
 * @returns        An unsubscribe function — close the watcher.
 *
 * @example
 *   const stop = await startFsWatcher('./flags.json', () => reload());
 *   // ... later
 *   await stop();
 */
export async function startFsWatcher(
  path: string,
  onChange: () => void,
): Promise<() => Promise<void>> {
  const runtime = detectRuntime();
  if (runtime !== 'node' && runtime !== 'bun') {
    return () => Promise.resolve();
  }
  // Dynamic import: keeps `node:fs` out of edge bundles.
  const fs = await import('node:fs');
  let pending: NodeJS.Timeout | undefined;
  const watcher = fs.watch(path, { persistent: false }, () => {
    if (pending !== undefined) clearTimeout(pending);
    pending = setTimeout(() => {
      onChange();
    }, 25);
  });
  return () =>
    new Promise<void>((resolve) => {
      if (pending !== undefined) clearTimeout(pending);
      try {
        watcher.close();
      } catch {
        // ignore
      }
      resolve();
    });
}

/**
 * Read a file from disk via dynamic import of `node:fs/promises`.
 * Throws on non-Node runtimes.
 *
 * @param path      Absolute or cwd-relative path.
 * @param encoding  Text encoding.
 * @returns         The file contents as a string.
 */
export async function readTextFile(
  path: string,
  encoding: BufferEncoding = 'utf8',
): Promise<string> {
  const runtime = detectRuntime();
  if (runtime !== 'node' && runtime !== 'bun') {
    throw new Error('readTextFile is only supported on Node.js / Bun');
  }
  const fs = await import('node:fs/promises');
  return fs.readFile(path, { encoding });
}
