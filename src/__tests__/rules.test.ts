import { describe, expect, it, vi } from 'vitest';
import { matchRule } from '../core/rules.js';
import '../matchers/extended/index.js';
import type { EvaluationContext } from '../types/context.js';
import type { RuleGroup } from '../types/rules.js';

const ctx = (attrs: Record<string, unknown>): EvaluationContext => ({
  subject: { id: 'u', attributes: attrs as never },
});

describe('matchRule: implicit-AND', () => {
  it('should return true when every attribute matcher passes', () => {
    const group = {
      plan: { eq: 'pro' },
      seats: { gte: 5 },
    } as unknown as RuleGroup;
    expect(matchRule(group, ctx({ plan: 'pro', seats: 5 }))).toBe(true);
  });

  it('should return false when any attribute matcher fails', () => {
    const group = {
      plan: { eq: 'pro' },
      seats: { gte: 5 },
    } as unknown as RuleGroup;
    expect(matchRule(group, ctx({ plan: 'pro', seats: 1 }))).toBe(false);
  });

  it('should return false on empty matcher object', () => {
    const group = { plan: {} } as unknown as RuleGroup;
    expect(matchRule(group, ctx({ plan: 'pro' }))).toBe(false);
  });

  it('should return true on empty group object', () => {
    expect(matchRule({} as RuleGroup, ctx({}))).toBe(true);
  });

  it('should treat undefined matcher as a no-op', () => {
    const group = { plan: undefined } as unknown as RuleGroup;
    expect(matchRule(group, ctx({}))).toBe(true);
  });
});

describe('matchRule: $and', () => {
  it('should require every child to match', () => {
    const group = {
      $and: [
        { plan: { eq: 'pro' } },
        { country: { eq: 'US' } },
      ],
    } as unknown as RuleGroup;
    expect(matchRule(group, ctx({ plan: 'pro', country: 'US' }))).toBe(true);
    expect(matchRule(group, ctx({ plan: 'pro', country: 'UK' }))).toBe(false);
  });
});

describe('matchRule: $or', () => {
  it('should match if any child matches', () => {
    const group = {
      $or: [{ plan: { eq: 'pro' } }, { plan: { eq: 'enterprise' } }],
    } as unknown as RuleGroup;
    expect(matchRule(group, ctx({ plan: 'enterprise' }))).toBe(true);
    expect(matchRule(group, ctx({ plan: 'free' }))).toBe(false);
  });
});

describe('matchRule: $not', () => {
  it('should invert child match', () => {
    const group = { $not: { plan: { eq: 'pro' } } } as unknown as RuleGroup;
    expect(matchRule(group, ctx({ plan: 'free' }))).toBe(true);
    expect(matchRule(group, ctx({ plan: 'pro' }))).toBe(false);
  });
});

describe('matchRule: $segment', () => {
  it('should resolve segment references', () => {
    const segments: Record<string, RuleGroup> = {
      proUsers: { plan: { eq: 'pro' } } as unknown as RuleGroup,
    };
    const group = { $segment: 'proUsers' } as unknown as RuleGroup;
    expect(matchRule(group, ctx({ plan: 'pro' }), segments)).toBe(true);
    expect(matchRule(group, ctx({ plan: 'free' }), segments)).toBe(false);
  });

  it('should return false when referenced segment is missing', () => {
    const group = { $segment: 'unknown' } as unknown as RuleGroup;
    expect(matchRule(group, ctx({}), {})).toBe(false);
  });

  it('should detect cycles and call reportError', () => {
    const segments: Record<string, RuleGroup> = {
      a: { $segment: 'b' } as unknown as RuleGroup,
      b: { $segment: 'a' } as unknown as RuleGroup,
    };
    const reportError = vi.fn();
    const group = { $segment: 'a' } as unknown as RuleGroup;
    const result = matchRule(group, ctx({}), { segments, reportError });
    expect(result).toBe(false);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'segment-cycle' }),
    );
  });

  it('should accept segments map as second argument shape', () => {
    const segments: Record<string, RuleGroup> = {
      pro: { plan: { eq: 'pro' } } as unknown as RuleGroup,
    };
    const group = { $segment: 'pro' } as unknown as RuleGroup;
    expect(matchRule(group, ctx({ plan: 'pro' }), segments)).toBe(true);
  });

  it('should fall through to implicit-AND when $segment is not a string', () => {
    const group = { $segment: 123 } as unknown as RuleGroup;
    expect(matchRule(group, ctx({}))).toBe(true);
  });
});

describe('matchRule: matcher errors', () => {
  it('should report and return false when a matcher throws', () => {
    const reportError = vi.fn();
    const group = {
      x: { custom: () => { throw new Error('boom'); } },
    } as unknown as RuleGroup;
    const result = matchRule(group, ctx({ x: 'val' }), { reportError });
    expect(result).toBe(false);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'matcher-throw', name: 'custom' }),
    );
  });

  it('should return false on unknown operator at runtime', () => {
    const group = { x: { totallyUnknownOp: 'val' } } as unknown as RuleGroup;
    expect(matchRule(group, ctx({ x: 'anything' }))).toBe(false);
  });

  it('should evaluate every op in a multi-op matcher (regex + eq sibling)', () => {
    const group = { x: { regex: '^x$', flags: '' } } as unknown as RuleGroup;
    expect(matchRule(group, ctx({ x: 'x' }))).toBe(true);
    expect(matchRule(group, ctx({ x: 'y' }))).toBe(false);
  });

  it('should miss attributes when subject is undefined', () => {
    const group = { plan: { eq: 'pro' } } as unknown as RuleGroup;
    expect(matchRule(group, {})).toBe(false);
  });
});
