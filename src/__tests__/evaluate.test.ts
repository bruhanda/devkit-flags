import { describe, expect, it } from 'vitest';
import { defineFlags } from '../core/define.js';

describe('evaluate: STATIC default', () => {
  it('should return the default when no rules / rollout / env match', () => {
    const flags = defineFlags({
      flags: { f: { kind: 'boolean', default: false } },
    });
    expect(flags.get('f')).toBe(false);
    expect(flags.getDetail('f').reason).toBe('STATIC');
  });
});

describe('evaluate: per-call OVERRIDE', () => {
  it('should return the override and reason=OVERRIDE', () => {
    const flags = defineFlags({
      flags: { f: { kind: 'boolean', default: false } },
    });
    const detail = flags.getDetail('f', { overrides: { f: true } });
    expect(detail.value).toBe(true);
    expect(detail.reason).toBe('OVERRIDE');
  });
});

describe('evaluate: TARGETING_MATCH', () => {
  it('should return rule.value when when-clause matches', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rules: [{ id: 'pro', when: { plan: { eq: 'pro' } }, value: true }],
        },
      },
      attributes: { plan: 'string' as const },
    });
    const detail = flags.getDetail('f', {
      subject: { id: 'u1', attributes: { plan: 'pro' } },
    });
    expect(detail.value).toBe(true);
    expect(detail.reason).toBe('TARGETING_MATCH');
    expect(detail.ruleId).toBe('pro');
  });

  it('should fall through when when-clause does not match', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rules: [{ when: { plan: { eq: 'pro' } }, value: true }],
        },
      },
      attributes: { plan: 'string' as const },
    });
    const detail = flags.getDetail('f', {
      subject: { id: 'u1', attributes: { plan: 'free' } },
    });
    expect(detail.value).toBe(false);
    expect(detail.reason).toBe('TARGETING_FALLBACK');
  });

  it('should treat a missing when as always-match', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rules: [{ value: true }],
        },
      },
    });
    expect(flags.get('f')).toBe(true);
  });
});

describe('evaluate: ROLLOUT', () => {
  it('should mark a 100% rollout as included', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rollout: { percentage: 100 },
        },
      },
    });
    const detail = flags.getDetail('f', { subject: { id: 'u1' } });
    expect(detail.value).toBe(true);
    expect(detail.reason).toBe('ROLLOUT_INCLUDED');
  });

  it('should mark a 0% rollout as excluded', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rollout: { percentage: 0 },
        },
      },
    });
    const detail = flags.getDetail('f', { subject: { id: 'u1' } });
    expect(detail.reason).toBe('ROLLOUT_EXCLUDED');
    expect(detail.value).toBe(false);
  });

  it('should select a variant for multivariate rollouts', () => {
    const flags = defineFlags({
      flags: {
        variant: {
          kind: 'string',
          default: 'a',
          values: ['a', 'b'] as const,
          rollout: { variants: { a: 50, b: 50 } as Record<'a' | 'b', number> },
        } as never,
      },
    });
    const detail = flags.getDetail('variant', { subject: { id: 'u1' } });
    expect(detail.reason).toBe('ROLLOUT_INCLUDED');
    expect(['a', 'b']).toContain(detail.value);
  });

  it('should be deterministic for the same subject id', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rollout: { percentage: 50 },
        },
      },
      salt: 'salt-v1',
    });
    const a = flags.get('f', { subject: { id: 'stable-user' } });
    const b = flags.get('f', { subject: { id: 'stable-user' } });
    expect(a).toBe(b);
  });

  it('should respect rule-level rollout', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rules: [
            {
              id: 'pro-roll',
              when: { plan: { eq: 'pro' } },
              rollout: { percentage: 100 },
            },
          ],
        },
      },
      attributes: { plan: 'string' as const },
    });
    const detail = flags.getDetail('f', {
      subject: { id: 'u', attributes: { plan: 'pro' } },
    });
    expect(detail.reason).toBe('ROLLOUT_INCLUDED');
    expect(detail.value).toBe(true);
  });

  it('should fall through to next rule on rollout exclusion', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rules: [
            { rollout: { percentage: 0 } },
            { value: true },
          ],
        },
      },
    });
    expect(flags.get('f')).toBe(true);
  });

  it('should fall through to flag-level rollout when rules exist but none match', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rules: [{ when: { plan: { eq: 'pro' } }, value: true }],
          rollout: { percentage: 100 },
        },
      },
      attributes: { plan: 'string' as const },
    });
    const detail = flags.getDetail('f', {
      subject: { id: 'u', attributes: { plan: 'free' } },
    });
    expect(detail.reason).toBe('ROLLOUT_INCLUDED');
  });
});

describe('evaluate: ENVIRONMENT', () => {
  it('should apply environment override after rules walk fails', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rules: [{ when: { plan: { eq: 'pro' } }, value: true }],
          environments: { staging: true },
        },
      },
      attributes: { plan: 'string' as const },
      environment: 'staging',
    });
    const detail = flags.getDetail('f', {
      subject: { id: 'u', attributes: { plan: 'free' } },
    });
    expect(detail.reason).toBe('ENVIRONMENT');
    expect(detail.value).toBe(true);
  });

  it('should apply environment override when no rules', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          environments: { staging: true },
        },
      },
      environment: 'staging',
    });
    expect(flags.get('f')).toBe(true);
  });

  it('should let context.environment override the configured environment', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          environments: { staging: true, production: false },
        },
      },
      environment: 'production',
    });
    expect(flags.get('f', { environment: 'staging' })).toBe(true);
  });
});

describe('evaluate: number range clamping', () => {
  it('should clamp the rule value into [min, max]', () => {
    const flags = defineFlags({
      flags: {
        n: {
          kind: 'number',
          default: 0,
          range: [0, 10] as const,
          rules: [{ value: 999 }],
        },
      },
    });
    expect(flags.get('n')).toBe(10);
  });
});

describe('evaluate: string values restriction', () => {
  it('should fall back to ERROR/default when value not in declared values', () => {
    const flags = defineFlags({
      flags: {
        v: {
          kind: 'string',
          default: 'a',
          values: ['a', 'b'] as const,
          environments: { dev: 'INVALID' as never },
        } as never,
      },
      environment: 'dev',
    });
    const detail = flags.getDetail('v');
    expect(detail.reason).toBe('ERROR');
    expect(detail.value).toBe('a');
  });
});

describe('evaluate: UNKNOWN_FLAG', () => {
  it('should return reason=ERROR when flag does not exist', () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
    });
    const detail = flags.getDetail('nonExistent' as never);
    expect(detail.reason).toBe('ERROR');
    expect(detail.value).toBeUndefined();
  });

  it('should use the call default when flag is unknown', () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
    });
    expect(flags.get('nonExistent' as never, undefined, true as never)).toBe(true);
  });
});

describe('evaluate: STALE reason', () => {
  it('should escalate STATIC to STALE on a stale snapshot', async () => {
    const stalishSource = {
      id: 'remote' as const,
      load: () =>
        Promise.resolve({
          flags: {},
          origin: 'remote' as const,
          stale: true,
        }),
      snapshot: () => ({
        flags: {},
        origin: 'remote' as const,
        stale: true,
      }),
      subscribe: () => () => {},
    };
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: false } },
      sources: [stalishSource],
    });
    await flags.ready();
    const detail = flags.getDetail('x');
    expect(detail.stale).toBe(true);
    expect(detail.reason).toBe('STALE');
  });
});

describe('evaluate: rule-level subjectId extractor', () => {
  it('should use a custom extractor for rollout bucketing', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rollout: {
            percentage: 100,
            subjectId: (ctx) => ctx.subject?.id ?? 'fallback',
          },
        },
      },
    });
    expect(flags.get('f', { subject: { id: 'x' } })).toBe(true);
  });

  it('should fall back to empty subject id when extractor throws', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rollout: {
            percentage: 100,
            subjectId: () => {
              throw new Error('boom');
            },
          },
        },
      },
    });
    expect(flags.get('f')).toBe(true);
  });

  it('should use a default config-level subjectId extractor', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rollout: { percentage: 100 },
        },
      },
      subjectId: (ctx) => ctx.subject?.id ?? 'anon',
    });
    expect(flags.get('f', { subject: { id: 'u1' } })).toBe(true);
  });
});

describe('evaluate: analytics-only rule', () => {
  it('should fire exposure but fall through', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rules: [{ id: 'analytics', when: { plan: { eq: 'pro' } } }],
        },
      },
      attributes: { plan: 'string' as const },
    });
    const detail = flags.getDetail('f', {
      subject: { id: 'u', attributes: { plan: 'pro' } },
    });
    expect(detail.value).toBe(false);
    expect(detail.reason).toBe('TARGETING_FALLBACK');
  });
});
