import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineFlags } from '../core/define.js';
import { createEnvSource } from '../sources/env/index.js';
import { createJsonSource } from '../sources/json/index.js';
import { composeSources } from '../sources/compose/index.js';
import { defaultsSource } from '../sources/defaults/index.js';
import '../matchers/extended/index.js';
import type { EvaluationEvent } from '../types/observability.js';

describe('integration: full source stack', () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env['FLAG_NEW_CHECKOUT'];
    delete process.env['FLAG_VARIANT'];
    delete process.env['FLAG_LABEL'];
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in original)) delete process.env[k];
    }
    Object.assign(process.env, original);
    vi.restoreAllMocks();
  });

  it('should overlay JSON over defaults and env over JSON', async () => {
    process.env['FLAG_LABEL'] = 'env-value';
    const flags = defineFlags({
      flags: {
        newCheckout: { kind: 'boolean', default: false },
        label: { kind: 'string', default: 'default' },
      },
      sources: [
        createJsonSource({
          flags: {
            newCheckout: { kind: 'boolean', default: true },
            label: { kind: 'string', default: 'json-value' },
          },
        }),
        createEnvSource(),
      ],
    });
    await flags.ready();
    expect(flags.get('newCheckout')).toBe(true);
    expect(flags.get('label')).toBe('env-value');
  });

  it('should resolve a percentage rollout consistently', () => {
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rollout: { percentage: 50 },
        },
      },
      salt: 'integration-test',
    });
    let on = 0;
    const N = 2_000;
    for (let i = 0; i < N; i++) {
      if (flags.get('f', { subject: { id: `u-${i}` } })) on += 1;
    }
    const ratio = on / N;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it('should deliver targeting + rollout combos with deterministic results', () => {
    const flags = defineFlags({
      flags: {
        feature: {
          kind: 'boolean',
          default: false,
          rules: [
            {
              id: 'pro-25',
              when: { plan: { eq: 'pro' } },
              rollout: { percentage: 25 },
            },
            { when: { plan: { eq: 'free' } }, value: false },
          ],
        },
      },
      attributes: { plan: 'string' as const },
    });
    const proCtx = { subject: { id: 'u-1', attributes: { plan: 'pro' as const } } };
    const a = flags.get('feature', proCtx);
    const b = flags.get('feature', proCtx);
    expect(a).toBe(b);
    expect(flags.get('feature', { subject: { id: 'u-1', attributes: { plan: 'free' as const } } })).toBe(false);
  });

  it('should fire onEvaluation exactly once per get()', () => {
    const events: EvaluationEvent[] = [];
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
      onEvaluation: (e) => {
        events.push(e);
      },
    });
    flags.get('x');
    expect(events).toHaveLength(1);
    expect(events[0]?.flagKey).toBe('x');
  });

  it('should report RULE_EVAL_ERROR when a custom matcher throws', () => {
    const events: EvaluationEvent[] = [];
    const flags = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rules: [
            {
              when: {
                plan: {
                  custom: () => {
                    throw new Error('boom');
                  },
                },
              } as never,
              value: true,
            },
          ],
        },
      },
      attributes: { plan: 'string' as const },
      onEvaluation: (e) => events.push(e),
    });
    flags.get('f', { subject: { id: 'u', attributes: { plan: 'pro' } } });
    expect(events.some((e) => e.error?.code === 'RULE_EVAL_ERROR')).toBe(true);
  });

  it('should expose an explicit composeSources stack', async () => {
    const composed = composeSources([
      defaultsSource({ x: { kind: 'boolean', default: false } }),
      createJsonSource({ flags: { x: { kind: 'boolean', default: true } } }),
    ]);
    const snap = await composed.load();
    expect((snap.flags['x'] as { default: boolean }).default).toBe(true);
  });

  it('should narrow types via defineFlags inferred schema', () => {
    const flags = defineFlags({
      flags: {
        plan: {
          kind: 'string',
          default: 'free',
          values: ['free', 'pro'] as const,
        },
        seats: { kind: 'number', default: 1, range: [1, 100] as const },
      },
    });
    const plan: 'free' | 'pro' = flags.get('plan');
    const seats: number = flags.get('seats');
    expect(plan).toBe('free');
    expect(seats).toBe(1);
  });
});
