import { describe, expect, it } from 'vitest';
import { composeSnapshots, toPublicSnapshot } from '../core/snapshot.js';
import type { FlagSourceSnapshot } from '../types/source.js';

describe('composeSnapshots', () => {
  const a: FlagSourceSnapshot = {
    flags: {
      x: { kind: 'boolean', default: false },
      y: { kind: 'string', default: 'a' },
    },
    origin: 'defaults',
    fetchedAt: 1000,
  };
  const b: FlagSourceSnapshot = {
    flags: {
      x: { kind: 'boolean', default: true },
    },
    origin: 'json',
    fetchedAt: 2000,
  };

  it('should let later sources win per flag key', () => {
    const merged = composeSnapshots([a, b]);
    expect((merged.flags['x'] as { default: boolean }).default).toBe(true);
    expect((merged.flags['y'] as { default: string }).default).toBe('a');
  });

  it('should record the source label per flag', () => {
    const merged = composeSnapshots([a, b]);
    expect(merged.sourceMap['x']).toBe('json');
    expect(merged.sourceMap['y']).toBe('defaults');
  });

  it('should pick the most recent fetchedAt', () => {
    const merged = composeSnapshots([a, b]);
    expect(merged.fetchedAt).toBe(2000);
  });

  it('should mark merged stale when any layer is stale', () => {
    const stale: FlagSourceSnapshot = {
      flags: {},
      origin: 'remote',
      stale: true,
    };
    const merged = composeSnapshots([a, stale]);
    expect(merged.stale).toBe(true);
  });

  it('should fall back to Date.now() when no fetchedAt is set', () => {
    const merged = composeSnapshots([{ flags: {}, origin: 'defaults' }]);
    expect(merged.fetchedAt).toBeGreaterThan(0);
  });

  it('should merge segments from layers', () => {
    const layer: FlagSourceSnapshot = {
      flags: {},
      segments: { pro: { plan: { eq: 'pro' } } as never },
      origin: 'json',
    };
    const merged = composeSnapshots([layer]);
    expect(merged.segments['pro']).toBeDefined();
  });

  it('should freeze the result', () => {
    const merged = composeSnapshots([a]);
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.flags)).toBe(true);
  });
});

describe('toPublicSnapshot', () => {
  it('should expose the merged flags as a frozen public snapshot', () => {
    const merged = composeSnapshots([
      { flags: { x: { kind: 'boolean', default: true } }, origin: 'defaults' },
    ]);
    const pub = toPublicSnapshot(merged);
    expect(pub.flags['x']).toBeDefined();
    expect(pub.origin).toBe('compose');
    expect(Object.isFrozen(pub)).toBe(true);
  });
});
