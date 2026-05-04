/**
 * Discrete runtime identifiers consulted by sources for runtime-aware
 * branching (e.g. `createRemoteSource` rejects `pollInterval` on
 * Workers). New runtimes must be added here AND in the probe below.
 */
export type Runtime =
  | 'node'
  | 'bun'
  | 'deno'
  | 'workers'
  | 'react-native'
  | 'browser'
  | 'unknown';

interface DenoGlobal {
  readonly env?: { toObject?: () => Record<string, string> };
  readonly version?: { readonly deno?: string };
}

interface BunGlobal {
  readonly env?: Record<string, string | undefined>;
  readonly version?: string;
}

interface ProcessGlobal {
  readonly env?: Record<string, string | undefined>;
  readonly versions?: Record<string, string | undefined>;
  readonly release?: { readonly name?: string };
}

interface NavigatorGlobal {
  readonly userAgent?: string;
  readonly product?: string;
}

const G = globalThis as typeof globalThis & {
  Deno?: DenoGlobal;
  Bun?: BunGlobal;
  process?: ProcessGlobal;
  navigator?: NavigatorGlobal;
  WorkerGlobalScope?: unknown;
  EdgeRuntime?: unknown;
};

let cached: Runtime | undefined;

/**
 * Detect the host runtime. Cached after first call — runtimes do not
 * change mid-process. The ONLY file allowed to inspect host globals;
 * a Biome rule bans `globalThis.process` / `Deno` / `Bun` reads
 * elsewhere in `src/`.
 *
 * @returns A stable runtime identifier.
 *
 * @example
 *   if (detectRuntime() === 'workers') {
 *     throw new FlagsError('INVALID_RUNTIME_OPTION', 'pollInterval unsupported on Workers');
 *   }
 */
export function detectRuntime(): Runtime {
  if (cached !== undefined) return cached;
  cached = probe();
  return cached;
}

function probe(): Runtime {
  if (typeof G.Deno !== 'undefined' && G.Deno?.version?.deno !== undefined) {
    return 'deno';
  }
  if (typeof G.Bun !== 'undefined' && typeof G.Bun.version === 'string') {
    return 'bun';
  }
  if (typeof G.EdgeRuntime !== 'undefined') {
    return 'workers';
  }
  if (
    typeof G.WorkerGlobalScope !== 'undefined' &&
    typeof G.navigator?.userAgent === 'string' &&
    G.navigator.userAgent.includes('Cloudflare-Workers')
  ) {
    return 'workers';
  }
  if (G.navigator?.product === 'ReactNative') {
    return 'react-native';
  }
  if (typeof G.process !== 'undefined' && G.process?.versions?.['node'] !== undefined) {
    return 'node';
  }
  if (typeof (globalThis as { document?: unknown }).document !== 'undefined') {
    return 'browser';
  }
  return 'unknown';
}

/**
 * Read the host environment-variable bag without crashing on runtimes
 * that do not expose one. Returns an empty object when the runtime has
 * no env-var concept (Workers without an `env` argument, RN, browser).
 *
 * @returns A `Record<string, string | undefined>` snapshot of the
 *          current host env-vars (or empty when the runtime has none).
 */
export function readHostEnv(): Record<string, string | undefined> {
  const rt = detectRuntime();
  if (rt === 'deno' && typeof G.Deno?.env?.toObject === 'function') {
    return G.Deno.env.toObject();
  }
  if (rt === 'bun' && G.Bun?.env !== undefined) {
    return G.Bun.env;
  }
  if (G.process?.env !== undefined) {
    return G.process.env;
  }
  return {};
}

/** Reset the cache — exported solely for tests. @internal */
export function _resetRuntimeCacheForTests(): void {
  cached = undefined;
}
