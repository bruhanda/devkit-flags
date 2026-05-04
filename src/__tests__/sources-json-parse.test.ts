import { describe, expect, it } from 'vitest';
import { FlagsError } from '../errors/base.js';
import { parseFlagsJson } from '../sources/json/parse.js';

describe('parseFlagsJson: top-level', () => {
  it('should parse a minimal valid payload', () => {
    const out = parseFlagsJson({
      flags: { x: { kind: 'boolean', default: false } },
    });
    expect(out.flags['x']).toBeDefined();
  });

  it('should parse a JSON string', () => {
    const out = parseFlagsJson('{"flags":{"x":{"kind":"boolean","default":true}}}');
    expect((out.flags['x'] as { default: boolean }).default).toBe(true);
  });

  it('should reject non-object payload', () => {
    expect(() => parseFlagsJson(null)).toThrow(FlagsError);
    expect(() => parseFlagsJson(42)).toThrow(FlagsError);
  });

  it('should wrap JSON parse errors as JSON_PARSE_ERROR', () => {
    try {
      parseFlagsJson('{not json}');
      expect.fail();
    } catch (err) {
      if (FlagsError.is(err)) expect(err.code).toBe('JSON_PARSE_ERROR');
    }
  });

  it('should reject unknown top-level fields', () => {
    expect(() =>
      parseFlagsJson({ flags: {}, mystery: 'x' } as never),
    ).toThrow(FlagsError);
  });

  it('should reject when flags field is missing', () => {
    expect(() => parseFlagsJson({})).toThrow(FlagsError);
  });

  it('should reject __proto__ flag keys', () => {
    const raw = '{"flags":{"__proto__":{"kind":"boolean","default":true}}}';
    expect(() => parseFlagsJson(raw)).toThrow(FlagsError);
  });
});

describe('parseFlagsJson: kinds and defaults', () => {
  it('should reject unknown kind', () => {
    expect(() =>
      parseFlagsJson({
        flags: { x: { kind: 'mystery', default: 1 } },
      }),
    ).toThrow(FlagsError);
  });

  it('should accept all four kinds', () => {
    const out = parseFlagsJson({
      flags: {
        a: { kind: 'boolean', default: true },
        b: { kind: 'string', default: 'x' },
        c: { kind: 'number', default: 0 },
        d: { kind: 'json', default: { x: 1 } },
      },
    });
    expect(Object.keys(out.flags)).toHaveLength(4);
  });

  it('should preserve description and tags', () => {
    const out = parseFlagsJson({
      flags: {
        x: {
          kind: 'boolean',
          default: false,
          description: 'kill switch',
          tags: ['critical'],
          deprecated: true,
        },
      },
    });
    expect((out.flags['x'] as { description?: string }).description).toBe('kill switch');
    expect((out.flags['x'] as { deprecated?: boolean }).deprecated).toBe(true);
  });

  it('should preserve string values list', () => {
    const out = parseFlagsJson({
      flags: {
        x: {
          kind: 'string',
          default: 'a',
          values: ['a', 'b'],
        },
      },
    });
    expect((out.flags['x'] as { values?: string[] }).values).toEqual(['a', 'b']);
  });

  it('should preserve number range', () => {
    const out = parseFlagsJson({
      flags: { x: { kind: 'number', default: 5, range: [0, 10] } },
    });
    expect((out.flags['x'] as { range?: [number, number] }).range).toEqual([0, 10]);
  });

  it('should reject malformed range', () => {
    expect(() =>
      parseFlagsJson({
        flags: { x: { kind: 'number', default: 0, range: [1, 'two'] } },
      }),
    ).toThrow(FlagsError);
  });

  it('should preserve environments map', () => {
    const out = parseFlagsJson({
      flags: {
        x: {
          kind: 'boolean',
          default: false,
          environments: { staging: true },
        },
      },
    });
    const env = (out.flags['x'] as { environments?: Record<string, unknown> }).environments;
    expect(env?.['staging']).toBe(true);
  });

  it('should drop __proto__ keys from environments', () => {
    const out = parseFlagsJson({
      flags: {
        x: {
          kind: 'boolean',
          default: false,
          environments: { __proto__: true, dev: true },
        },
      },
    });
    const env = (out.flags['x'] as { environments?: Record<string, unknown> }).environments;
    expect(env?.['dev']).toBe(true);
    expect(env?.['__proto__']).toBeUndefined();
  });
});

describe('parseFlagsJson: rules', () => {
  it('should parse a basic rule', () => {
    const out = parseFlagsJson({
      flags: {
        x: {
          kind: 'boolean',
          default: false,
          rules: [
            { id: 'pro', when: { plan: { eq: 'pro' } }, value: true },
          ],
        },
      },
    });
    const rules = (out.flags['x'] as { rules?: unknown[] }).rules;
    expect(rules).toHaveLength(1);
  });

  it('should parse $and / $or / $not', () => {
    const out = parseFlagsJson({
      flags: {
        x: {
          kind: 'boolean',
          default: false,
          rules: [
            {
              when: {
                $and: [
                  { plan: { eq: 'pro' } },
                  { $or: [{ country: { eq: 'US' } }] },
                  { $not: { plan: { eq: 'free' } } },
                ],
              },
              value: true,
            },
          ],
        },
      },
    });
    expect(out.flags['x']).toBeDefined();
  });

  it('should reject $and with non-array', () => {
    expect(() =>
      parseFlagsJson({
        flags: {
          x: {
            kind: 'boolean',
            default: false,
            rules: [{ when: { $and: 'invalid' as never } }],
          },
        },
      }),
    ).toThrow(FlagsError);
  });

  it('should reject $or with non-array', () => {
    expect(() =>
      parseFlagsJson({
        flags: {
          x: {
            kind: 'boolean',
            default: false,
            rules: [{ when: { $or: 'invalid' as never } }],
          },
        },
      }),
    ).toThrow(FlagsError);
  });

  it('should resolve $segment references', () => {
    const out = parseFlagsJson({
      flags: {
        x: {
          kind: 'boolean',
          default: false,
          rules: [{ when: { $segment: 'pro' }, value: true }],
        },
      },
      segments: {
        pro: { plan: { eq: 'pro' } },
      },
    });
    expect(out.segments['pro']).toBeDefined();
  });

  it('should reject $segment references to undeclared segments', () => {
    expect(() =>
      parseFlagsJson({
        flags: {
          x: {
            kind: 'boolean',
            default: false,
            rules: [{ when: { $segment: 'nonExistent' }, value: true }],
          },
        },
      }),
    ).toThrow(FlagsError);
  });

  it('should reject non-string $segment', () => {
    expect(() =>
      parseFlagsJson({
        flags: {
          x: {
            kind: 'boolean',
            default: false,
            rules: [{ when: { $segment: 1 as never } }],
          },
        },
      }),
    ).toThrow(FlagsError);
  });
});

describe('parseFlagsJson: matchers', () => {
  it('should reject custom matchers as UNSAFE_MATCHER_FROM_JSON', () => {
    try {
      parseFlagsJson({
        flags: {
          x: {
            kind: 'boolean',
            default: false,
            rules: [{ when: { plan: { custom: 'fn' } as never } }],
          },
        },
      });
      expect.fail();
    } catch (err) {
      if (FlagsError.is(err)) expect(err.code).toBe('UNSAFE_MATCHER_FROM_JSON');
    }
  });

  it('should reject unknown matcher operators', () => {
    expect(() =>
      parseFlagsJson({
        flags: {
          x: {
            kind: 'boolean',
            default: false,
            rules: [{ when: { plan: { equals: 'pro' } as never } }],
          },
        },
      }),
    ).toThrow(FlagsError);
  });

  it('should accept regex matcher with flags sibling', () => {
    const out = parseFlagsJson({
      flags: {
        x: {
          kind: 'boolean',
          default: false,
          rules: [{ when: { id: { regex: '^abc', flags: 'i' } } }],
        },
      },
    });
    expect(out.flags['x']).toBeDefined();
  });

  it('should reject non-string regex pattern', () => {
    expect(() =>
      parseFlagsJson({
        flags: {
          x: {
            kind: 'boolean',
            default: false,
            rules: [{ when: { id: { regex: 5 as never } } }],
          },
        },
      }),
    ).toThrow(FlagsError);
  });

  it('should reject overly long regex patterns', () => {
    const long = 'a'.repeat(1100);
    expect(() =>
      parseFlagsJson({
        flags: {
          x: {
            kind: 'boolean',
            default: false,
            rules: [{ when: { id: { regex: long } } }],
          },
        },
      }),
    ).toThrow(FlagsError);
  });

  it('should reject deeply nested lookbehind', () => {
    const pattern = '(?<=(?<=(?<=(?<=a)b)c)d)e';
    expect(() =>
      parseFlagsJson({
        flags: {
          x: {
            kind: 'boolean',
            default: false,
            rules: [{ when: { id: { regex: pattern } } }],
          },
        },
      }),
    ).toThrow(FlagsError);
  });

  it('should reject non-string regex flags', () => {
    expect(() =>
      parseFlagsJson({
        flags: {
          x: {
            kind: 'boolean',
            default: false,
            rules: [{ when: { id: { regex: '^x', flags: 5 as never } } }],
          },
        },
      }),
    ).toThrow(FlagsError);
  });
});

describe('parseFlagsJson: rollout', () => {
  it('should parse a percentage rollout', () => {
    const out = parseFlagsJson({
      flags: {
        x: {
          kind: 'boolean',
          default: false,
          rollout: { percentage: 25 },
        },
      },
    });
    expect((out.flags['x'] as { rollout?: { percentage: number } }).rollout?.percentage).toBe(25);
  });

  it('should reject percentage outside [0, 100]', () => {
    expect(() =>
      parseFlagsJson({
        flags: {
          x: {
            kind: 'boolean',
            default: false,
            rollout: { percentage: 150 },
          },
        },
      }),
    ).toThrow(FlagsError);
  });

  it('should parse a variants rollout', () => {
    const out = parseFlagsJson({
      flags: {
        x: {
          kind: 'string',
          default: 'a',
          rollout: { variants: { a: 50, b: 50 } },
        },
      },
    });
    expect(
      (out.flags['x'] as { rollout?: { variants: Record<string, number> } }).rollout?.variants['a'],
    ).toBe(50);
  });

  it('should drop __proto__ variant names', () => {
    const out = parseFlagsJson({
      flags: {
        x: {
          kind: 'string',
          default: 'a',
          rollout: { variants: { __proto__: 50, a: 100 } as never },
        },
      },
    });
    const variants = (out.flags['x'] as { rollout?: { variants: Record<string, number> } }).rollout?.variants;
    expect(variants?.['__proto__']).toBeUndefined();
  });

  it('should reject variant with non-finite weight', () => {
    expect(() =>
      parseFlagsJson({
        flags: {
          x: {
            kind: 'string',
            default: 'a',
            rollout: { variants: { a: 'oops' as never } },
          },
        },
      }),
    ).toThrow(FlagsError);
  });

  it('should reject rollout with neither percentage nor variants', () => {
    expect(() =>
      parseFlagsJson({
        flags: {
          x: {
            kind: 'boolean',
            default: false,
            rollout: {} as never,
          },
        },
      }),
    ).toThrow(FlagsError);
  });
});

describe('parseFlagsJson: segments', () => {
  it('should reject __proto__ segment names', () => {
    const raw =
      '{"flags":{},"segments":{"__proto__":{"plan":{"eq":"pro"}}}}';
    expect(() => parseFlagsJson(raw)).toThrow(FlagsError);
  });
});
