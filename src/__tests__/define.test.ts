import { describe, expect, it } from 'vitest';
import { defineFlags } from '../core/define.js';
import { createFlags } from '../core/flags.js';
import { FlagsError } from '../errors/base.js';

describe('defineFlags', () => {
  it('should return a frozen handle', () => {
    const flags = defineFlags({
      flags: { newCheckout: { kind: 'boolean', default: false } },
    });
    expect(Object.isFrozen(flags)).toBe(true);
  });

  it('should expose schema-typed get for boolean flags', () => {
    const flags = defineFlags({
      flags: { newCheckout: { kind: 'boolean', default: false } },
    });
    expect(flags.get('newCheckout')).toBe(false);
  });

  it('should expose number values', () => {
    const flags = defineFlags({
      flags: { speedLimit: { kind: 'number', default: 60 } },
    });
    expect(flags.get('speedLimit')).toBe(60);
  });

  it('should expose string values', () => {
    const flags = defineFlags({
      flags: {
        variant: { kind: 'string', default: 'a', values: ['a', 'b'] as const },
      },
    });
    expect(flags.get('variant')).toBe('a');
  });

  it('should expose JSON values', () => {
    const flags = defineFlags({
      flags: { config: { kind: 'json', default: { x: 1 } } },
    });
    expect(flags.get('config')).toEqual({ x: 1 });
  });

  it('should propagate validation errors at construction', () => {
    expect(() =>
      defineFlags({
        flags: { broken: { kind: 'boolean', default: 'yes' as never } },
      }),
    ).toThrow(FlagsError);
  });
});

describe('createFlags', () => {
  it('should be the underlying factory used by defineFlags', () => {
    const flags = createFlags({
      flags: { x: { kind: 'boolean', default: true } },
    });
    expect(flags.get('x')).toBe(true);
  });

  it('should expose snapshot()', () => {
    const flags = createFlags({
      flags: { x: { kind: 'boolean', default: true } },
    });
    const snap = flags.snapshot();
    expect(snap.flags['x']).toBeDefined();
    expect(snap.origin).toBe('compose');
  });

  it('should expose version()', () => {
    const flags = createFlags({
      flags: { x: { kind: 'boolean', default: true } },
    });
    expect(typeof flags.version()).toBe('number');
  });
});
