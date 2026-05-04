import { FlagsError } from '../../errors/base.js';
import { coerce, clampNumber } from '../../core/coerce.js';
import { deepFreeze } from '../../utils/freeze.js';
import { detectRuntime, readHostEnv } from '../../utils/runtime.js';
import type {
  BooleanFlagSpec,
  FlagSpec,
  JsonFlagSpec,
  NumberFlagSpec,
  StringFlagSpec,
} from '../../types/flag-spec.js';
import type { FlagSource, FlagSourceSnapshot } from '../../types/source.js';
import { normalizeFlagKey } from './normalize-key.js';

interface EnvSourceOptions {
  /** Variable prefix. Default: `'FLAG_'`. Set `''` to disable prefixing. */
  readonly prefix?: string;
  /** Explicit env bag — required on Cloudflare Workers; auto-detected elsewhere. */
  readonly env?: Record<string, string | undefined>;
  /** Override the camelCase → SCREAMING_SNAKE transform. */
  readonly toEnvVarName?: (flagKey: string) => string;
  /**
   * Allowlist of flag keys that may be overridden by env-vars. Default
   * is `'schema'` — the source consults the schema produced by the
   * handle's other sources at evaluation time. Pass an explicit array
   * to narrow further; pass `'*'` to read every `${prefix}*` env-var.
   */
  readonly allow?: readonly string[] | '*';
}

/**
 * Read flag overrides from environment variables. The key transform is
 *   `flagKey ('newCheckout')` → `${prefix}NEW_CHECKOUT`
 *
 * Values are coerced based on the flag's declared `kind` at evaluation
 * time, NOT at construction time, so mid-process `process.env.FLAG_X = ...`
 * is observed by subsequent reads (handy for tests).
 *
 * Allowlist defaults: only env-vars whose names map back to a declared
 * flag are read. Unmapped collisions emit a one-time `console.warn` so
 * accidental `FLAG_INTERNAL_DEBUG_TOKEN` collisions are visible.
 *
 * @param opts  Optional configuration.
 * @returns     A `FlagSource` that overlays env-var values.
 *
 * @example
 *   defineFlags({
 *     flags: { newCheckout: { kind: 'boolean', default: false } },
 *     sources: [createEnvSource()],
 *   });
 *   // FLAG_NEW_CHECKOUT=true  →  flags.get('newCheckout') === true
 */
export function createEnvSource(opts?: EnvSourceOptions): FlagSource {
  const prefix = opts?.prefix ?? 'FLAG_';
  const transform = opts?.toEnvVarName ?? normalizeFlagKey;
  const allow = opts?.allow;
  const explicitEnv = opts?.env;
  const runtime = detectRuntime();
  if (runtime === 'workers' && explicitEnv === undefined) {
    throw new FlagsError(
      'INVALID_RUNTIME_OPTION',
      'createEnvSource: pass `opts.env` on Cloudflare Workers (Workers has no globalThis env-vars)',
      {
        context: { runtime },
      },
    );
  }

  const listeners = new Set<(s: FlagSourceSnapshot) => void>();
  const warnedCollisions = new Set<string>();
  // Tracks the env-keys we've already iterated for collision-warning
  // purposes. The full host env can be hundreds of vars on production
  // boxes; without this we'd re-scan on every `reload()`.
  const scannedKeys = new Set<string>();
  let cachedSchema: Readonly<Record<string, FlagSpec>> = {};
  let snapshot: FlagSourceSnapshot | undefined;

  function readEnv(): Record<string, string | undefined> {
    return explicitEnv ?? readHostEnv();
  }

  function buildSnapshot(): FlagSourceSnapshot {
    const env = readEnv();
    // Null-prototype map so `__proto__`/`constructor`/`prototype`
    // collisions can never reach `Object.prototype`. The schema-derived
    // allowlist below already excludes them in practice, but defence
    // in depth keeps the parser-shaped guarantees consistent.
    const flags: Record<string, FlagSpec> = Object.create(null);
    const allowSet =
      allow === '*' || allow === undefined
        ? undefined
        : new Set<string>(allow);

    const schemaKeys = Object.keys(cachedSchema);
    if (allow === '*') {
      // Untargeted: scan env for keys, infer kind from cachedSchema when known.
      for (const [envName, raw] of Object.entries(env)) {
        if (raw === undefined) continue;
        if (!envName.startsWith(prefix)) continue;
        const stem = envName.slice(prefix.length);
        const matchedKey = schemaKeys.find((k) => transform(k) === stem);
        if (matchedKey === undefined) continue;
        const spec = cachedSchema[matchedKey];
        if (spec === undefined) continue;
        const overlay = buildOverlay(spec, raw);
        if (overlay !== undefined) flags[matchedKey] = overlay;
      }
    } else {
      // Targeted by allowlist — schema-derived by default.
      const targets = allowSet !== undefined ? allowSet : new Set(schemaKeys);
      for (const flagKey of targets) {
        const spec = cachedSchema[flagKey];
        if (spec === undefined) continue;
        const envName = `${prefix}${transform(flagKey)}`;
        const raw = env[envName];
        if (raw === undefined) continue;
        const overlay = buildOverlay(spec, raw);
        if (overlay !== undefined) flags[flagKey] = overlay;
      }
      // Warn on prefix collisions outside the allowlist. Only inspect
      // env-keys we haven't seen on a previous `reload()` — production
      // boxes routinely carry hundreds of unrelated env-vars and the
      // collision check is the dominant cost of a snapshot rebuild
      // otherwise.
      if (allow === undefined) {
        for (const envName of Object.keys(env)) {
          if (scannedKeys.has(envName)) continue;
          scannedKeys.add(envName);
          if (!envName.startsWith(prefix)) continue;
          const stem = envName.slice(prefix.length);
          const declared = schemaKeys.some((k) => transform(k) === stem);
          if (!declared && !warnedCollisions.has(envName)) {
            warnedCollisions.add(envName);
            // eslint-disable-next-line no-console
            console.warn(
              `[devkit/flags] env-var ${envName} matches the ${prefix} prefix but no declared flag — typo?`,
            );
          }
        }
      }
    }

    return deepFreeze({
      flags,
      origin: 'env' as const,
      fetchedAt: Date.now(),
    });
  }

  function buildOverlay(spec: FlagSpec, raw: string): FlagSpec | undefined {
    try {
      let value: unknown = coerce(raw, spec.kind);
      if (spec.kind === 'number') {
        const numberSpec = spec as NumberFlagSpec;
        if (numberSpec.range !== undefined) {
          value = clampNumber(value as number, numberSpec.range);
        }
      }
      if (spec.kind === 'string') {
        const stringSpec = spec as StringFlagSpec;
        if (
          stringSpec.values !== undefined &&
          !stringSpec.values.includes(value as string)
        ) {
          return undefined;
        }
      }
      return makeOverlaySpec(spec, value);
    } catch {
      return undefined;
    }
  }

  return {
    id: 'env',
    async load() {
      snapshot = buildSnapshot();
      return snapshot;
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
      snapshot = buildSnapshot();
      for (const l of listeners) l(snapshot);
      return snapshot;
    },
    bindSchema(schema) {
      cachedSchema = schema;
    },
  };

  // Helpers below the closure to avoid hoisting noise.
}

function makeOverlaySpec(spec: FlagSpec, value: unknown): FlagSpec {
  switch (spec.kind) {
    case 'boolean':
      return { ...(spec as BooleanFlagSpec), default: value as boolean };
    case 'number':
      return { ...(spec as NumberFlagSpec), default: value as number };
    case 'string':
      return { ...(spec as StringFlagSpec), default: value as string };
    case 'json':
      return {
        ...(spec as JsonFlagSpec),
        default: value as JsonFlagSpec['default'],
      };
  }
}
