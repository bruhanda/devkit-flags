import { describe, expect, it } from 'vitest';
import { defineFlags } from '../core/define.js';
import {
  createOpenFeatureProvider,
  translateReason,
} from '../adapters/openfeature/index.js';

describe('translateReason', () => {
  it('should map every internal reason to an OpenFeature reason', () => {
    const cases: [string, string][] = [
      ['STATIC', 'STATIC'],
      ['ENVIRONMENT', 'TARGETING_MATCH'],
      ['TARGETING_MATCH', 'TARGETING_MATCH'],
      ['TARGETING_FALLBACK', 'DEFAULT'],
      ['ROLLOUT_INCLUDED', 'SPLIT'],
      ['ROLLOUT_EXCLUDED', 'SPLIT'],
      ['OVERRIDE', 'OVERRIDE'],
      ['STALE', 'STALE'],
      ['ERROR', 'ERROR'],
    ];
    for (const [from, to] of cases) {
      expect(translateReason(from as never)).toBe(to);
    }
  });
});

describe('createOpenFeatureProvider', () => {
  const flags = defineFlags({
    flags: {
      bool: { kind: 'boolean', default: false },
      str: { kind: 'string', default: 'a' },
      num: { kind: 'number', default: 7 },
      obj: { kind: 'json', default: { x: 1 } },
    },
  });
  const provider = createOpenFeatureProvider(flags);

  it('should expose a metadata.name field', () => {
    expect(provider.metadata.name).toBe('@devkit/flags');
  });

  it('should resolve booleans', () => {
    const r = provider.resolveBooleanEvaluation('bool', true);
    expect(r.value).toBe(false);
    expect(r.reason).toBe('STATIC');
  });

  it('should resolve strings', () => {
    const r = provider.resolveStringEvaluation('str', 'fallback');
    expect(r.value).toBe('a');
  });

  it('should resolve numbers', () => {
    const r = provider.resolveNumberEvaluation('num', 0);
    expect(r.value).toBe(7);
  });

  it('should resolve objects', () => {
    const r = provider.resolveObjectEvaluation('obj', {});
    expect(r.value).toEqual({ x: 1 });
  });

  it('should pass targetingKey as subject.id', () => {
    const flags2 = defineFlags({
      flags: {
        f: {
          kind: 'boolean',
          default: false,
          rules: [{ when: { plan: { eq: 'pro' } }, value: true }],
        },
      },
      attributes: { plan: 'string' as const },
    });
    const p = createOpenFeatureProvider(flags2);
    const r = p.resolveBooleanEvaluation('f', false, {
      targetingKey: 'u1',
      plan: 'pro',
    });
    expect(r.value).toBe(true);
  });

  it('should return ERROR resolution when flag is unknown', () => {
    const r = provider.resolveBooleanEvaluation('nonExistent', true);
    expect(r.reason).toBe('ERROR');
    expect(r.errorCode).toBe('GENERAL');
  });

  it('should handle context with no targetingKey but attributes', () => {
    const r = provider.resolveBooleanEvaluation('bool', true, {
      plan: 'pro',
    });
    expect(r.value).toBe(false);
  });

  it('should handle undefined context', () => {
    const r = provider.resolveBooleanEvaluation('bool', true);
    expect(r.value).toBe(false);
  });
});
