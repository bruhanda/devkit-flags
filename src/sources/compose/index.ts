import { deepFreeze } from '../../utils/freeze.js';
import type { FlagSpec } from '../../types/flag-spec.js';
import type { RuleGroup } from '../../types/rules.js';
import type {
  FlagSource,
  FlagSourceSnapshot,
} from '../../types/source.js';

interface ComposeOptions {
  /** Per-flag combiner. Defaults to "last source wins" object replacement. */
  readonly merge?: (key: string, layers: readonly FlagSpec[]) => FlagSpec;
}

/**
 * Overlay multiple sources in priority order. Later sources win per
 * flag key — by default a later source's spec REPLACES (not deep-merges)
 * an earlier one. Pass `opts.merge` to plug in a custom combiner.
 *
 * Most consumers don't reach for this directly — passing
 * `sources: [a, b, c]` to `defineFlags` invokes `composeSources`
 * automatically. Use it explicitly when you want a non-default merge
 * order or want to wrap a composed source as a sub-component of a
 * larger source array.
 *
 * @param sources  Ordered list of sources; index 0 is lowest priority.
 * @param opts     Optional merge customisation.
 * @returns        A composed `FlagSource` exposing the merged snapshot.
 *
 * @example
 *   composeSources([defaultsSource(s), createJsonSource('./flags.json')]);
 */
export function composeSources(
  sources: readonly FlagSource[],
  opts?: ComposeOptions,
): FlagSource {
  const subscriptions: (() => void)[] = [];
  const listeners = new Set<(s: FlagSourceSnapshot) => void>();
  let composed: FlagSourceSnapshot | undefined;

  function rebuild(): FlagSourceSnapshot {
    const snapshots = sources
      .map((s) => s.snapshot())
      .filter((s): s is FlagSourceSnapshot => s !== undefined);
    composed = mergeSnapshots(snapshots, opts);
    return composed;
  }

  for (const source of sources) {
    subscriptions.push(
      source.subscribe(() => {
        const next = rebuild();
        for (const listener of listeners) listener(next);
      }),
    );
  }

  return {
    id: 'compose',
    async load() {
      const snapshots = await Promise.all(sources.map((s) => s.load()));
      composed = mergeSnapshots(snapshots, opts);
      return composed;
    },
    snapshot() {
      return composed ?? rebuild();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async reload() {
      const snapshots = await Promise.all(
        sources.map((s) => (s.reload !== undefined ? s.reload() : s.load())),
      );
      composed = mergeSnapshots(snapshots, opts);
      return composed;
    },
    async close() {
      for (const unsub of subscriptions) unsub();
      subscriptions.length = 0;
      listeners.clear();
      for (const source of sources) {
        if (source.close !== undefined) await source.close();
      }
    },
  };
}

function mergeSnapshots(
  layers: readonly FlagSourceSnapshot[],
  opts?: ComposeOptions,
): FlagSourceSnapshot {
  const flags: Record<string, FlagSpec> = Object.create(null);
  const segments: Record<string, RuleGroup> = Object.create(null);
  const seenLayers: Record<string, FlagSpec[]> = Object.create(null);
  let stale = false;
  let fetchedAt = 0;

  for (const layer of layers) {
    if (layer.stale === true) stale = true;
    if (typeof layer.fetchedAt === 'number' && layer.fetchedAt > fetchedAt) {
      fetchedAt = layer.fetchedAt;
    }
    for (const [key, spec] of Object.entries(layer.flags)) {
      if (opts?.merge !== undefined) {
        if (seenLayers[key] === undefined) seenLayers[key] = [];
        seenLayers[key].push(spec);
      } else {
        flags[key] = spec;
      }
    }
    if (layer.segments !== undefined) {
      for (const [name, group] of Object.entries(layer.segments)) {
        segments[name] = group;
      }
    }
  }

  if (opts?.merge !== undefined) {
    for (const [key, stack] of Object.entries(seenLayers)) {
      flags[key] = opts.merge(key, stack);
    }
  }

  return deepFreeze({
    flags,
    segments,
    origin: 'compose' as const,
    stale,
    fetchedAt: fetchedAt === 0 ? Date.now() : fetchedAt,
  });
}
