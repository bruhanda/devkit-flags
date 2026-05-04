import { describe, expect, it } from 'vitest';
import { invariant } from '../core/invariant.js';
import { FlagsError } from '../errors/base.js';

describe('invariant', () => {
  it('should not throw when condition is truthy', () => {
    expect(() => invariant(1, 'INVALID_SCHEMA', 'msg')).not.toThrow();
    expect(() => invariant({}, 'INVALID_SCHEMA', 'msg')).not.toThrow();
    expect(() => invariant('non-empty', 'INVALID_SCHEMA', 'msg')).not.toThrow();
  });

  it('should throw FlagsError with the supplied code on falsy condition', () => {
    try {
      invariant(false, 'INVALID_SCHEMA', 'boom');
      expect.fail('expected throw');
    } catch (err) {
      expect(FlagsError.is(err)).toBe(true);
      if (FlagsError.is(err)) {
        expect(err.code).toBe('INVALID_SCHEMA');
        expect(err.message).toBe('boom');
      }
    }
  });

  it('should attach context when supplied', () => {
    try {
      invariant(0, 'TYPE_MISMATCH', 'bad', { foo: 'bar' });
      expect.fail();
    } catch (err) {
      if (FlagsError.is(err)) {
        expect(err.context).toEqual({ foo: 'bar' });
      }
    }
  });

  it('should treat empty string as falsy and throw', () => {
    expect(() => invariant('', 'INVALID_SCHEMA', 'oops')).toThrow(FlagsError);
  });

  it('should treat null and undefined as falsy', () => {
    expect(() => invariant(null, 'INVALID_SCHEMA', 'a')).toThrow(FlagsError);
    expect(() => invariant(undefined, 'INVALID_SCHEMA', 'b')).toThrow(FlagsError);
  });
});
