import { FlagsError } from '../../errors/base.js';
import { deepFreeze } from '../../utils/freeze.js';
import { detectRuntime } from '../../utils/runtime.js';
import type { FlagSource, FlagSourceSnapshot } from '../../types/source.js';
import { parseFlagsJson } from './parse.js';
import { readTextFile, startFsWatcher } from './watch.js';

/** Inline JSON shape accepted by `createJsonSource` directly. */
export interface FlagsJsonInput {
  readonly $schema?: string;
  readonly flags: Readonly<Record<string, unknown>>;
  readonly environments?: readonly string[];
  readonly segments?: Readonly<Record<string, unknown>>;
}

interface JsonSourceOptions {
  /** Enable `node:fs.watch` (Node + Bun only). Default: `false`. */
  readonly watch?: boolean;
  /** Encoding when reading from disk. Default: `'utf8'`. */
  readonly encoding?: BufferEncoding;
}

type JsonSourceInput =
  | string
  | URL
  | FlagsJsonInput
  | (() => Promise<FlagsJsonInput | string | URL> | FlagsJsonInput | string | URL);

/**
 * Load a flags overlay from JSON. Four input forms:
 *
 *   1. **Path**     `createJsonSource('./flags.json')`
 *   2. **URL**      `createJsonSource(new URL('https://cdn/flags.json'))`
 *   3. **Object**   `createJsonSource({ flags: { ... } })`
 *   4. **Function** `createJsonSource(() => readFromCms())`
 *
 * `opts.watch` enables `node:fs.watch` on Node / Bun (no-op elsewhere).
 *
 * @param input  Path, URL, raw object, or async producer.
 * @param opts   Optional behaviour customisation.
 * @returns      A `FlagSource` that overlays the JSON payload.
 *
 * @example
 *   defineFlags({
 *     flags: { newCheckout: { kind: 'boolean', default: false } },
 *     sources: [createJsonSource('./flags.json', { watch: true })],
 *   });
 */
export function createJsonSource(
  input: JsonSourceInput,
  opts?: JsonSourceOptions,
): FlagSource {
  const encoding: BufferEncoding = opts?.encoding ?? 'utf8';
  const listeners = new Set<(s: FlagSourceSnapshot) => void>();
  let snapshot: FlagSourceSnapshot | undefined;
  let stopWatcher: (() => Promise<void>) | undefined;

  async function fetchPayload(): Promise<FlagsJsonInput> {
    let resolved: JsonSourceInput = input;
    if (typeof resolved === 'function') {
      resolved = await resolved();
    }
    if (typeof resolved === 'string') {
      const text = await readTextFile(resolved, encoding);
      return JSON.parse(text) as FlagsJsonInput;
    }
    if (resolved instanceof URL) {
      const response = await fetch(resolved);
      if (!response.ok) {
        throw new FlagsError(
          'SOURCE_LOAD_FAILED',
          `JSON source ${resolved.toString()} returned ${response.status}`,
        );
      }
      return (await response.json()) as FlagsJsonInput;
    }
    return resolved;
  }

  async function load(): Promise<FlagSourceSnapshot> {
    const payload = await fetchPayload();
    const parsed = parseFlagsJson(payload);
    snapshot = deepFreeze({
      flags: parsed.flags,
      segments: parsed.segments,
      origin: 'json' as const,
      fetchedAt: Date.now(),
    });
    return snapshot;
  }

  async function maybeStartWatcher(): Promise<void> {
    if (opts?.watch !== true || stopWatcher !== undefined) return;
    if (typeof input !== 'string') return;
    const runtime = detectRuntime();
    if (runtime !== 'node' && runtime !== 'bun') return;
    stopWatcher = await startFsWatcher(input, () => {
      void load()
        .then((next) => {
          for (const l of listeners) l(next);
        })
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[devkit/flags] JSON source watch reload failed:', err);
        });
    });
  }

  return {
    id: 'json',
    async load() {
      const next = await load();
      await maybeStartWatcher();
      return next;
    },
    snapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async reload() {
      return load();
    },
    async close() {
      listeners.clear();
      if (stopWatcher !== undefined) {
        await stopWatcher();
        stopWatcher = undefined;
      }
    },
  };
}

export { parseFlagsJson } from './parse.js';
