import { describe, expect, it, vi } from 'vitest';
import { composeSources } from '../sources/compose/index.js';
import { defaultsSource } from '../sources/defaults/index.js';
import type { FlagSource, FlagSourceSnapshot } from '../types/source.js';

function makeSource(snap: FlagSourceSnapshot, id: 'json' | 'env' = 'json'): FlagSource {
  let listener: ((s: FlagSourceSnapshot) => void) | undefined;
  return {
    id,
    async load() {
      return snap;
    },
    snapshot() {
      return snap;
    },
    subscribe(l) {
      listener = l;
      return () => {
        listener = undefined;
      };
    },
    async reload() {
      return snap;
    },
    async close() {
      // ignore
    },
    // expose a hook to manually fire updates
    ...(listener as never),
  };
}

describe('composeSources', () => {
  it('should let later sources win', async () => {
    const a = defaultsSource({ x: { kind: 'boolean', default: false } });
    const b = makeSource({
      flags: { x: { kind: 'boolean', default: true } },
      origin: 'json',
    });
    const composed = composeSources([a, b]);
    const snap = await composed.load();
    expect((snap.flags['x'] as { default: boolean }).default).toBe(true);
  });

  it('should expose origin=compose', async () => {
    const a = defaultsSource({ x: { kind: 'boolean', default: true } });
    const composed = composeSources([a]);
    const snap = await composed.load();
    expect(snap.origin).toBe('compose');
  });

  it('should fall through to rebuild when no cached snapshot', () => {
    const a = defaultsSource({ x: { kind: 'boolean', default: true } });
    const composed = composeSources([a]);
    const snap = composed.snapshot();
    expect(snap?.origin).toBe('compose');
  });

  it('should support a custom merge function', async () => {
    const a = makeSource({
      flags: { x: { kind: 'string', default: 'a' } },
      origin: 'json',
    });
    const b = makeSource({
      flags: { x: { kind: 'string', default: 'b' } },
      origin: 'env',
    }, 'env');
    const merge = vi.fn(
      (_key, layers) => layers[layers.length - 1]!,
    );
    const composed = composeSources([a, b], { merge });
    const snap = await composed.load();
    expect(merge).toHaveBeenCalled();
    expect((snap.flags['x'] as { default: string }).default).toBe('b');
  });

  it('should reload via load on sources without reload', async () => {
    const a = defaultsSource({ x: { kind: 'boolean', default: true } });
    const composed = composeSources([a]);
    const next = await composed.reload!();
    expect(next.origin).toBe('compose');
  });

  it('should call close on each sub-source', async () => {
    const close = vi.fn();
    const sub: FlagSource = {
      id: 'json',
      async load() {
        return { flags: {}, origin: 'json' };
      },
      snapshot() {
        return undefined;
      },
      subscribe() {
        return () => {};
      },
      close,
    };
    const composed = composeSources([sub]);
    await composed.close!();
    expect(close).toHaveBeenCalled();
  });

  it('should propagate subscribe events via listeners', () => {
    const listeners = new Set<(s: FlagSourceSnapshot) => void>();
    const source: FlagSource = {
      id: 'json',
      async load() {
        return { flags: {}, origin: 'json' };
      },
      snapshot() {
        return { flags: {}, origin: 'json' };
      },
      subscribe(l) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    const composed = composeSources([source]);
    const heard = vi.fn();
    composed.subscribe(heard);
    for (const l of listeners) l({ flags: { y: { kind: 'boolean', default: true } }, origin: 'json' });
    expect(heard).toHaveBeenCalled();
  });

  it('should merge segments from layers', async () => {
    const a = makeSource({
      flags: {},
      segments: { pro: { plan: { eq: 'pro' } } as never },
      origin: 'json',
    });
    const composed = composeSources([a]);
    const snap = await composed.load();
    expect(snap.segments?.['pro']).toBeDefined();
  });
});
