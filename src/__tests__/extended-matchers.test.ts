import { describe, expect, it } from 'vitest';
import { getMatcher } from '../core/matchers.js';
import { resetRegexState } from '../matchers/extended/index.js';
import type { Operator } from '../types/rules.js';

const m = (op: Operator) => getMatcher(op)!;

describe('extended matchers — gt / gte / lt / lte', () => {
  it('should compare numbers correctly', () => {
    expect(m('gt')(5, 10)).toBe(true);
    expect(m('gt')(10, 5)).toBe(false);
    expect(m('gte')(5, 5)).toBe(true);
    expect(m('lt')(10, 5)).toBe(true);
    expect(m('lte')(5, 5)).toBe(true);
  });

  it('should compare strings lexicographically', () => {
    expect(m('gt')('a', 'b')).toBe(true);
    expect(m('lt')('b', 'a')).toBe(true);
  });

  it('should coerce mixed string/number where possible', () => {
    expect(m('gt')(5, '10')).toBe(true);
    expect(m('gt')('5', 10)).toBe(true);
  });

  it('should return false on non-comparable types', () => {
    expect(m('gt')(5, undefined)).toBe(false);
    expect(m('gt')(5, null)).toBe(false);
  });

  it('should return false when string cannot be parsed to a number', () => {
    expect(m('gt')(5, 'NaN')).toBe(false);
    expect(m('gt')('NaN', 5)).toBe(false);
  });
});

describe('extended matchers — string ops', () => {
  it('contains should test substring', () => {
    expect(m('contains')('foo', 'a foo bar')).toBe(true);
    expect(m('contains')('zzz', 'a foo bar')).toBe(false);
  });

  it('startsWith should test prefix', () => {
    expect(m('startsWith')('hello', 'hello world')).toBe(true);
    expect(m('startsWith')('world', 'hello world')).toBe(false);
  });

  it('endsWith should test suffix', () => {
    expect(m('endsWith')('world', 'hello world')).toBe(true);
    expect(m('endsWith')('hello', 'hello world')).toBe(false);
  });

  it('should return false for non-string actuals', () => {
    expect(m('contains')('a', undefined)).toBe(false);
    expect(m('startsWith')('a', 5 as never)).toBe(false);
  });
});

describe('extended matchers — regex', () => {
  it('should match a simple pattern', () => {
    resetRegexState();
    expect(m('regex')({ regex: '^abc' }, 'abcdef')).toBe(true);
    expect(m('regex')({ regex: '^abc' }, 'xabc')).toBe(false);
  });

  it('should respect flags', () => {
    resetRegexState();
    expect(m('regex')({ regex: '^abc', flags: 'i' }, 'ABCDEF')).toBe(true);
  });

  it('should return false for non-string actuals', () => {
    resetRegexState();
    expect(m('regex')({ regex: '^abc' }, undefined)).toBe(false);
    expect(m('regex')({ regex: '^abc' }, 1 as never)).toBe(false);
  });

  it('should return false on invalid regex pattern', () => {
    resetRegexState();
    expect(m('regex')({ regex: '(unclosed' }, 'x')).toBe(false);
  });

  it('should return false when matcher object is not an object', () => {
    expect(m('regex')(null, 'x')).toBe(false);
  });

  it('should return false when regex field is missing', () => {
    expect(m('regex')({}, 'x')).toBe(false);
  });

  it('should default flags to empty string when invalid', () => {
    resetRegexState();
    expect(m('regex')({ regex: '^a$', flags: 123 as never }, 'a')).toBe(true);
  });

  it('should re-use cached compiled regex on subsequent calls', () => {
    resetRegexState();
    const matcher = m('regex');
    expect(matcher({ regex: 'foo' }, 'foobar')).toBe(true);
    expect(matcher({ regex: 'foo' }, 'foobar')).toBe(true);
  });
});

describe('extended matchers — custom', () => {
  it('should call the function and return its boolean', () => {
    expect(m('custom')((v: unknown) => v === 'special', 'special')).toBe(true);
    expect(m('custom')((v: unknown) => v === 'special', 'other')).toBe(false);
  });

  it('should return false when expected is not a function', () => {
    expect(m('custom')('not a function', 'x')).toBe(false);
  });

  it('should propagate the throw (caught by evaluateMatcher)', () => {
    expect(() =>
      m('custom')(() => {
        throw new Error('boom');
      }, 'x'),
    ).toThrow('boom');
  });
});

describe('resetRegexState', () => {
  it('should clear the compiled regex cache and health map', () => {
    resetRegexState();
    expect(() => resetRegexState()).not.toThrow();
  });
});
