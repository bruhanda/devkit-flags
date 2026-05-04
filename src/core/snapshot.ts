import { deepFreeze } from '../utils/freeze.js';
import type { FlagSpec } from '../types/flag-spec.js';
import type { RuleGroup } from '../types/rules.js';
import type { FlagSourceSnapshot } from '../types/source.js';

/**
 * Merged, frozen snapshot used by every `flags.get*()` call. Built by
 * `composeSnapshots` from the per-source contributions; readers
 * capture a reference at entry so a concurrent reload swap never
 * tears values mid-evaluation.
 */
export interface MergedSnapshot {
  readonly flags: Readonly<Record<string, FlagSpec>>;
  readonly segments: Readonly<Record<string, RuleGroup>>;
  readonly stale: boolean;
  /** Source label for each flag — used to populate `EvaluationResult.source`. */
  readonly sourceMap: Readonly<Record<string, FlagSourceSnapshot['origin']>>;
  readonly fetchedAt: number;
}

/**
 * Compose ordered source contributions into a single merged snapshot.
 * Later sources win per flag key (object-shallow merge — a later
 * source's flag spec REPLACES, not deep-merges, an earlier one).
 *
 * @param layers  Ordered source contributions; index 0 is lowest priority.
 * @returns       A frozen merged snapshot.
 *
 * @example
 *   const merged = composeSnapshots([defaultsSnap, jsonSnap, envSnap]);
 *   merged.flags['newCheckout']; // env wins over json wins over defaults
 */
export function composeSnapshots(
  layers: readonly FlagSourceSnapshot[],
): MergedSnapshot {
  const flags: Record<string, FlagSpec> = {};
  const segments: Record<string, RuleGroup> = {};
  const sourceMap: Record<string, FlagSourceSnapshot['origin']> = {};
  let stale = false;
  let fetchedAt = 0;

  for (const layer of layers) {
    if (layer.stale === true) stale = true;
    if (typeof layer.fetchedAt === 'number' && layer.fetchedAt > fetchedAt) {
      fetchedAt = layer.fetchedAt;
    }
    for (const [key, spec] of Object.entries(layer.flags)) {
      flags[key] = spec;
      sourceMap[key] = layer.origin;
    }
    if (layer.segments !== undefined) {
      for (const [name, group] of Object.entries(layer.segments)) {
        segments[name] = group;
      }
    }
  }

  return deepFreeze({
    flags,
    segments,
    sourceMap,
    stale,
    fetchedAt: fetchedAt === 0 ? Date.now() : fetchedAt,
  });
}

/**
 * Convert a `MergedSnapshot` back to a public `FlagSourceSnapshot`
 * shape — useful for `FlagsHandle.snapshot()` callers that want to
 * inspect the merged payload.
 */
export function toPublicSnapshot(merged: MergedSnapshot): FlagSourceSnapshot {
  return deepFreeze({
    flags: merged.flags,
    segments: merged.segments,
    origin: 'compose' as const,
    stale: merged.stale,
    fetchedAt: merged.fetchedAt,
  });
}
