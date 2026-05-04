import { describe, expect, it } from 'vitest';
import { clampNumber, coerce } from '../core/coerce.js';
import { FlagsError } from '../errors/base.js';

describe('coerce: boolean', () => {
  it('should pass through a boolean value', () => {
    expect(coerce(true, 'boolean')).toBe(true);
    expect(coerce(false, 'boolean')).toBe(false);
  });

  it('should map truthy strings to true', () => {
    for (const tok of ['true', 'TRUE', '1', 'on', 'YES', '  yes  ']) {
      expect(coerce(tok, 'boolean')).toBe(true);
    }
  });

  it('should map falsy strings to false', () => {
    for (const tok of ['false', '0', 'off', 'no', '']) {
      expect(coerce(tok, 'boolean')).toBe(false);
    }
  });

  it('should coerce a finite non-zero number to true', () => {
    expect(coerce(1, 'boolean')).toBe(true);
    expect(coerce(-3, 'boolean')).toBe(true);
  });

  it('should coerce zero to false', () => {
    expect(coerce(0, 'boolean')).toBe(false);
  });

  it('should throw TYPE_MISMATCH for unrepresentable strings', () => {
    expect(() => coerce('maybe', 'boolean')).toThrow(FlagsError);
  });

  it('should throw TYPE_MISMATCH for null', () => {
    expect(() => coerce(null, 'boolean')).toThrow(FlagsError);
  });

  it('should throw TYPE_MISMATCH for non-finite numbers', () => {
    expect(() => coerce(Number.NaN, 'boolean')).toThrow(FlagsError);
  });
});

describe('coerce: number', () => {
  it('should pass through a finite number', () => {
    expect(coerce(42, 'number')).toBe(42);
  });

  it('should reject non-finite numbers', () => {
    expect(() => coerce(Number.NaN, 'number')).toThrow(FlagsError);
    expect(() => coerce(Number.POSITIVE_INFINITY, 'number')).toThrow(FlagsError);
  });

  it('should parse a numeric string', () => {
    expect(coerce('42', 'number')).toBe(42);
    expect(coerce('  -3.5  ', 'number')).toBe(-3.5);
  });

  it('should reject the empty string as a number', () => {
    expect(() => coerce('', 'number')).toThrow(FlagsError);
  });

  it('should map booleans to 0 or 1', () => {
    expect(coerce(true, 'number')).toBe(1);
    expect(coerce(false, 'number')).toBe(0);
  });

  it('should reject non-numeric strings', () => {
    expect(() => coerce('xyz', 'number')).toThrow(FlagsError);
  });

  it('should reject objects', () => {
    expect(() => coerce({}, 'number')).toThrow(FlagsError);
  });
});

describe('coerce: string', () => {
  it('should pass through a string', () => {
    expect(coerce('hello', 'string')).toBe('hello');
  });

  it('should stringify a finite number', () => {
    expect(coerce(42, 'string')).toBe('42');
  });

  it('should stringify booleans', () => {
    expect(coerce(true, 'string')).toBe('true');
    expect(coerce(false, 'string')).toBe('false');
  });

  it('should reject non-finite numbers', () => {
    expect(() => coerce(Number.NaN, 'string')).toThrow(FlagsError);
  });

  it('should reject objects', () => {
    expect(() => coerce({ a: 1 }, 'string')).toThrow(FlagsError);
  });
});

describe('coerce: json', () => {
  it('should return null when given null', () => {
    expect(coerce(null, 'json')).toBe(null);
  });

  it('should pass through booleans / numbers', () => {
    expect(coerce(true, 'json')).toBe(true);
    expect(coerce(3.14, 'json')).toBe(3.14);
  });

  it('should parse a JSON object literal', () => {
    expect(coerce('{"a":1}', 'json')).toEqual({ a: 1 });
  });

  it('should parse a JSON array literal', () => {
    expect(coerce('[1,2,3]', 'json')).toEqual([1, 2, 3]);
  });

  it('should parse the JSON null literal', () => {
    expect(coerce('null', 'json')).toBe(null);
  });

  it('should treat a non-JSON-shape string as a plain string', () => {
    expect(coerce('hello', 'json')).toBe('hello');
  });

  it('should freeze the returned object', () => {
    const out = coerce({ nested: { x: 1 } }, 'json') as { nested: { x: number } };
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.nested)).toBe(true);
  });

  it('should freeze the result of parsing a JSON string', () => {
    const out = coerce('{"a":1}', 'json') as Record<string, number>;
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('should throw TYPE_MISMATCH on malformed JSON literals', () => {
    expect(() => coerce('{not json}', 'json')).toThrow(FlagsError);
  });

  it('should throw TYPE_MISMATCH for unsupported primitive types like symbol', () => {
    expect(() => coerce(Symbol('x'), 'json')).toThrow(FlagsError);
  });

  it('should freeze an array', () => {
    const out = coerce([1, 2, [3]], 'json') as readonly unknown[];
    expect(Object.isFrozen(out)).toBe(true);
  });
});

describe('coerce: invalid kind', () => {
  it('should throw TYPE_MISMATCH for an unknown kind', () => {
    expect(() => coerce('x', 'mystery' as never)).toThrow(FlagsError);
  });
});

describe('clampNumber', () => {
  it('should pass through values within range', () => {
    expect(clampNumber(5, [0, 10])).toBe(5);
  });

  it('should clamp values below the minimum', () => {
    expect(clampNumber(-1, [0, 10])).toBe(0);
  });

  it('should clamp values above the maximum', () => {
    expect(clampNumber(11, [0, 10])).toBe(10);
  });

  it('should pass through boundary values', () => {
    expect(clampNumber(0, [0, 10])).toBe(0);
    expect(clampNumber(10, [0, 10])).toBe(10);
  });
});
