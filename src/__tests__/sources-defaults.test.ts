import { describe, expect, it } from 'vitest';
import { defaultsSource } from '../sources/defaults/index.js';

describe('defaultsSource', () => {
  it('should expose schema as origin=defaults', () => {
    const source = defaultsSource({
      x: { kind: 'boolean', default: true },
    });
    const snap = source.snapshot();
    expect(snap?.origin).toBe('defaults');
    expect(snap?.flags['x']).toBeDefined();
  });

  it('should resolve load() with the same snapshot', async () => {
    const source = defaultsSource({
      x: { kind: 'boolean', default: false },
    });
    const loaded = await source.load();
    expect(loaded.flags['x']).toBeDefined();
  });

  it('should expose a noop subscribe function', () => {
    const source = defaultsSource({});
    const unsubscribe = source.subscribe(() => {});
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
  });

  it('should freeze the snapshot', () => {
    const source = defaultsSource({ x: { kind: 'boolean', default: true } });
    const snap = source.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
  });
});
