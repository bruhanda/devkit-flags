import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../utils/freeze.js';
import { once } from '../utils/once.js';
import { parseJson } from '../utils/safe-json.js';

describe('deepFreeze', () => {
  it('should freeze the top-level object', () => {
    const out = deepFreeze({ a: 1 });
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('should freeze nested objects recursively', () => {
    const out = deepFreeze({ a: { b: { c: 1 } } });
    expect(Object.isFrozen(out.a)).toBe(true);
    expect(Object.isFrozen(out.a.b)).toBe(true);
  });

  it('should freeze array contents', () => {
    const out = deepFreeze([{ a: 1 }, { b: 2 }]);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out[0])).toBe(true);
  });

  it('should pass through primitives unchanged', () => {
    expect(deepFreeze(1)).toBe(1);
    expect(deepFreeze('s')).toBe('s');
    expect(deepFreeze(null)).toBe(null);
  });

  it('should not re-freeze already-frozen objects', () => {
    const inner = Object.freeze({ x: 1 });
    expect(() => deepFreeze({ inner })).not.toThrow();
  });
});

describe('once', () => {
  it('should call the factory only once even on concurrent invocations', async () => {
    let calls = 0;
    const fn = once(async () => {
      calls += 1;
      return 'hello';
    });
    const [a, b, c] = await Promise.all([fn(), fn(), fn()]);
    expect(a).toBe('hello');
    expect(b).toBe('hello');
    expect(c).toBe('hello');
    expect(calls).toBe(1);
  });

  it('should return the same promise reference across calls', () => {
    const fn = once(async () => 1);
    const p1 = fn();
    const p2 = fn();
    expect(p1).toBe(p2);
  });

  it('should propagate errors from the factory', async () => {
    const fn = once(async () => {
      throw new Error('boom');
    });
    await expect(fn()).rejects.toThrow('boom');
  });
});

describe('parseJson', () => {
  it('should return ok=true with the parsed value on valid JSON', () => {
    const r = parseJson<{ a: number }>('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });

  it('should return ok=false with the error on invalid JSON', () => {
    const r = parseJson('{not json}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeDefined();
  });

  it('should parse arrays and primitives', () => {
    const arr = parseJson<number[]>('[1,2]');
    expect(arr.ok && arr.value).toEqual([1, 2]);
    const num = parseJson<number>('42');
    expect(num.ok && num.value).toBe(42);
  });
});
