import { describe, expect, it } from 'vitest';
import { validateSchema } from '../core/validate.js';
import { FlagsError } from '../errors/base.js';
import type { FlagSchema } from '../types/flag-schema.js';

describe('validateSchema: kind', () => {
  it('should reject non-object specs', () => {
    expect(() => validateSchema({ x: null as never })).toThrow(FlagsError);
  });

  it('should reject unknown kinds', () => {
    expect(() =>
      validateSchema({ x: { kind: 'mystery', default: 1 } as never }),
    ).toThrow(FlagsError);
  });

  it('should accept all four valid kinds', () => {
    const schema: FlagSchema = {
      a: { kind: 'boolean', default: true },
      b: { kind: 'string', default: '' },
      c: { kind: 'number', default: 0 },
      d: { kind: 'json', default: null },
    };
    expect(() => validateSchema(schema)).not.toThrow();
  });
});

describe('validateSchema: defaults', () => {
  it('should reject non-boolean default for boolean kind', () => {
    expect(() =>
      validateSchema({ a: { kind: 'boolean', default: 'true' as never } }),
    ).toThrow(FlagsError);
  });

  it('should reject non-string default for string kind', () => {
    expect(() =>
      validateSchema({ a: { kind: 'string', default: 42 as never } }),
    ).toThrow(FlagsError);
  });

  it('should reject default not in the values set', () => {
    expect(() =>
      validateSchema({
        a: {
          kind: 'string',
          default: 'a',
          values: ['b', 'c'] as const,
        } as never,
      }),
    ).toThrow(FlagsError);
  });

  it('should reject non-finite number defaults', () => {
    expect(() =>
      validateSchema({ a: { kind: 'number', default: Number.NaN } }),
    ).toThrow(FlagsError);
  });

  it('should accept JSON defaults of any shape', () => {
    expect(() =>
      validateSchema({ a: { kind: 'json', default: { foo: 'bar' } } }),
    ).not.toThrow();
  });
});

describe('validateSchema: range', () => {
  it('should reject ranges that are not 2-tuples', () => {
    expect(() =>
      validateSchema({
        a: { kind: 'number', default: 0, range: [1, 2, 3] as never },
      }),
    ).toThrow(FlagsError);
  });

  it('should reject ranges with min > max', () => {
    expect(() =>
      validateSchema({
        a: { kind: 'number', default: 0, range: [10, 0] as const },
      }),
    ).toThrow(FlagsError);
  });

  it('should accept a valid range', () => {
    expect(() =>
      validateSchema({
        a: { kind: 'number', default: 5, range: [0, 10] as const },
      }),
    ).not.toThrow();
  });
});

describe('validateSchema: rules', () => {
  it('should reject rule values whose type does not match the flag kind', () => {
    expect(() =>
      validateSchema({
        a: {
          kind: 'boolean',
          default: false,
          rules: [{ value: 'yes' as never }],
        },
      }),
    ).toThrow(FlagsError);
  });

  it('should accept rules whose values match the flag kind', () => {
    expect(() =>
      validateSchema({
        a: { kind: 'boolean', default: false, rules: [{ value: true }] },
      }),
    ).not.toThrow();
  });

  it('should reject string rule values not in the values list', () => {
    expect(() =>
      validateSchema({
        a: {
          kind: 'string',
          default: 'a',
          values: ['a', 'b'] as const,
          rules: [{ value: 'c' as never }],
        } as never,
      }),
    ).toThrow(FlagsError);
  });
});

describe('validateSchema: rollout', () => {
  it('should accept a percentage in [0, 100]', () => {
    expect(() =>
      validateSchema({
        a: { kind: 'boolean', default: false, rollout: { percentage: 50 } },
      }),
    ).not.toThrow();
  });

  it('should reject a percentage outside [0, 100]', () => {
    expect(() =>
      validateSchema({
        a: { kind: 'boolean', default: false, rollout: { percentage: 150 } },
      }),
    ).toThrow(FlagsError);
  });

  it('should accept variants that sum to 100', () => {
    expect(() =>
      validateSchema({
        a: {
          kind: 'string',
          default: 'a',
          values: ['a', 'b', 'c'] as const,
          rollout: { variants: { a: 50, b: 30, c: 20 } },
        } as never,
      }),
    ).not.toThrow();
  });

  it('should reject variants whose weights do not sum to 100', () => {
    expect(() =>
      validateSchema({
        a: {
          kind: 'string',
          default: 'a',
          values: ['a', 'b'] as const,
          rollout: { variants: { a: 50, b: 30 } },
        } as never,
      }),
    ).toThrow(FlagsError);
  });

  it('should reject empty variants', () => {
    expect(() =>
      validateSchema({
        a: {
          kind: 'string',
          default: 'a',
          rollout: { variants: {} as never },
        } as never,
      }),
    ).toThrow(FlagsError);
  });

  it('should reject negative variant weights', () => {
    expect(() =>
      validateSchema({
        a: {
          kind: 'string',
          default: 'a',
          rollout: { variants: { a: -10, b: 110 } },
        } as never,
      }),
    ).toThrow(FlagsError);
  });

  it('should reject variant names not in declared values for string kind', () => {
    expect(() =>
      validateSchema({
        a: {
          kind: 'string',
          default: 'a',
          values: ['a', 'b'] as const,
          rollout: { variants: { a: 50, c: 50 } },
        } as never,
      }),
    ).toThrow(FlagsError);
  });

  it('should reject a rollout that has neither percentage nor variants', () => {
    expect(() =>
      validateSchema({
        a: { kind: 'boolean', default: false, rollout: {} as never },
      }),
    ).toThrow(FlagsError);
  });
});
