import { describe, expect, it } from 'vitest';
import { FlagsError } from '../errors/base.js';
import { FLAGS_ERROR_CODES } from '../errors/codes.js';

describe('FlagsError', () => {
  it('should carry code, message and name when constructed', () => {
    const err = new FlagsError('INVALID_SCHEMA', 'broken');
    expect(err.code).toBe('INVALID_SCHEMA');
    expect(err.message).toBe('broken');
    expect(err.name).toBe('FlagsError');
    expect(err).toBeInstanceOf(Error);
  });

  it('should expose cause when supplied', () => {
    const cause = new Error('inner');
    const err = new FlagsError('JSON_PARSE_ERROR', 'outer', { cause });
    expect(err.cause).toBe(cause);
  });

  it('should freeze context when supplied', () => {
    const err = new FlagsError('INVALID_SCHEMA', 'msg', { context: { x: 1 } });
    expect(err.context).toEqual({ x: 1 });
    expect(Object.isFrozen(err.context)).toBe(true);
  });

  it('should leave context undefined when not supplied', () => {
    const err = new FlagsError('INVALID_SCHEMA', 'msg');
    expect(err.context).toBeUndefined();
  });

  it('should leave cause undefined when not supplied', () => {
    const err = new FlagsError('INVALID_SCHEMA', 'msg');
    expect(err.cause).toBeUndefined();
  });
});

describe('FlagsError.is', () => {
  it('should return true for FlagsError instances', () => {
    const err = new FlagsError('INVALID_SCHEMA', 'x');
    expect(FlagsError.is(err)).toBe(true);
  });

  it('should return false for plain Error instances', () => {
    expect(FlagsError.is(new Error('x'))).toBe(false);
  });

  it('should return false for non-error values', () => {
    expect(FlagsError.is(undefined)).toBe(false);
    expect(FlagsError.is(null)).toBe(false);
    expect(FlagsError.is({})).toBe(false);
    expect(FlagsError.is('string')).toBe(false);
  });

  it('should return true when an Error has matching name+code (cross-realm safe)', () => {
    const fake = new Error('msg') as Error & { code?: string };
    Object.defineProperty(fake, 'name', { value: 'FlagsError' });
    fake.code = 'INVALID_SCHEMA';
    expect(FlagsError.is(fake)).toBe(true);
  });
});

describe('FLAGS_ERROR_CODES', () => {
  it('should be a non-empty readonly tuple', () => {
    expect(FLAGS_ERROR_CODES.length).toBeGreaterThan(0);
    expect(FLAGS_ERROR_CODES).toContain('INVALID_SCHEMA');
    expect(FLAGS_ERROR_CODES).toContain('UNKNOWN_FLAG');
  });
});
