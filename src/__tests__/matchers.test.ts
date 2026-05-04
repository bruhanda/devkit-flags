import { describe, expect, it } from 'vitest';
import { getMatcher, registerMatchers } from '../core/matchers.js';
import type { Operator } from '../types/rules.js';

describe('core matchers — eq', () => {
  it('should return true when scalar values are deeply equal', () => {
    const eq = getMatcher('eq')!;
    expect(eq('pro', 'pro')).toBe(true);
    expect(eq(1, 1)).toBe(true);
    expect(eq(true, true)).toBe(true);
  });

  it('should return false when scalar values differ', () => {
    const eq = getMatcher('eq')!;
    expect(eq('pro', 'free')).toBe(false);
  });

  it('should compare arrays structurally', () => {
    const eq = getMatcher('eq')!;
    expect(eq([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(eq([1, 2], [1, 2, 3])).toBe(false);
  });

  it('should compare objects structurally', () => {
    const eq = getMatcher('eq')!;
    expect(eq({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(eq({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('should compare nested structures', () => {
    const eq = getMatcher('eq')!;
    expect(eq({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
  });

  it('should treat undefined and null distinctly', () => {
    const eq = getMatcher('eq')!;
    expect(eq(null, null)).toBe(true);
    expect(eq(null, undefined)).toBe(false);
    expect(eq(undefined, null)).toBe(false);
  });

  it('should return false when comparing object to array', () => {
    const eq = getMatcher('eq')!;
    expect(eq([1, 2], { 0: 1, 1: 2 } as never)).toBe(false);
  });
});

describe('core matchers — neq', () => {
  it('should be the negation of eq', () => {
    const neq = getMatcher('neq')!;
    expect(neq('a', 'b')).toBe(true);
    expect(neq('a', 'a')).toBe(false);
  });
});

describe('core matchers — in / nin', () => {
  it('in should return true when actual is in expected array', () => {
    const inFn = getMatcher('in')!;
    expect(inFn(['a', 'b', 'c'], 'b')).toBe(true);
    expect(inFn([1, 2, 3], 2)).toBe(true);
  });

  it('in should return false when actual is missing or undefined', () => {
    const inFn = getMatcher('in')!;
    expect(inFn(['a'], 'b')).toBe(false);
    expect(inFn(['a'], undefined)).toBe(false);
  });

  it('in should return false when expected is not an array', () => {
    const inFn = getMatcher('in')!;
    expect(inFn('not-array', 'a')).toBe(false);
  });

  it('nin should be the negation of in', () => {
    const nin = getMatcher('nin')!;
    expect(nin(['a'], 'b')).toBe(true);
    expect(nin(['a'], 'a')).toBe(false);
  });

  it('in should compare structurally for objects in array', () => {
    const inFn = getMatcher('in')!;
    expect(inFn([{ a: 1 }, { a: 2 }], { a: 2 })).toBe(true);
  });
});

describe('core matchers — exists', () => {
  it('should return true when wanted=true and value present', () => {
    const exists = getMatcher('exists')!;
    expect(exists(true, 'x')).toBe(true);
    expect(exists(true, 0)).toBe(true);
  });

  it('should return false when wanted=true and value undefined or null', () => {
    const exists = getMatcher('exists')!;
    expect(exists(true, undefined)).toBe(false);
    expect(exists(true, null)).toBe(false);
  });

  it('should invert when wanted=false', () => {
    const exists = getMatcher('exists')!;
    expect(exists(false, undefined)).toBe(true);
    expect(exists(false, 'x')).toBe(false);
  });
});

describe('registerMatchers', () => {
  it('should register a new matcher and look it up', () => {
    registerMatchers({
      ['custom-test' as Operator]: (e, a) => e === a,
    });
    const fn = getMatcher('custom-test' as Operator);
    expect(fn).toBeDefined();
    expect(fn?.('a', 'a')).toBe(true);
  });

  it('should ignore undefined entries', () => {
    expect(() =>
      registerMatchers({ eq: undefined as never }),
    ).not.toThrow();
  });

  it('should return undefined for unknown operators', () => {
    expect(getMatcher('totally-fake' as Operator)).toBeUndefined();
  });
});
