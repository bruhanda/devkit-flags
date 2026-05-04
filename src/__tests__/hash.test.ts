import { describe, expect, it, expectTypeOf } from 'vitest';
import { fnv1a32 } from '../core/hash.js';

describe('fnv1a32', () => {
  it('should return a deterministic hash when called twice with the same input', () => {
    expect(fnv1a32('hello')).toBe(fnv1a32('hello'));
  });

  it('should return different hashes for different inputs', () => {
    expect(fnv1a32('a')).not.toBe(fnv1a32('b'));
  });

  it('should return the FNV offset basis when input is the empty string', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });

  it('should return an unsigned 32-bit integer when called', () => {
    const hash = fnv1a32('the quick brown fox');
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(hash)).toBe(true);
  });

  it('should differ for inputs that are anagrams', () => {
    expect(fnv1a32('abc')).not.toBe(fnv1a32('cba'));
  });

  it('should produce a number for unicode input', () => {
    const hash = fnv1a32('héllo🚀');
    expect(typeof hash).toBe('number');
    expect(hash).toBeGreaterThanOrEqual(0);
  });

  it('should return the hash as a number type', () => {
    expectTypeOf(fnv1a32('x')).toEqualTypeOf<number>();
  });
});
