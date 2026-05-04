import { describe, expect, it } from 'vitest';
import {
  BUCKET_RESOLUTION,
  bucketFor,
  bucketIndex,
  variantBucketFor,
} from '../core/bucket.js';

describe('bucketIndex', () => {
  it('should return a value within [0, BUCKET_RESOLUTION) for any input', () => {
    for (const id of ['u1', 'u2', 'u3', '', 'special:char']) {
      const b = bucketIndex('salt', 'flag', id);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(BUCKET_RESOLUTION);
    }
  });

  it('should return the same bucket when called twice with the same triple', () => {
    expect(bucketIndex('s', 'f', 'u')).toBe(bucketIndex('s', 'f', 'u'));
  });

  it('should differ when salt differs', () => {
    const a = bucketIndex('s1', 'f', 'u');
    const b = bucketIndex('s2', 'f', 'u');
    expect(a).not.toBe(b);
  });
});

describe('bucketFor', () => {
  it('should return included=false without bucket when percentage <= 0', () => {
    expect(bucketFor('s', 'f', 'u', 0)).toEqual({ included: false });
    expect(bucketFor('s', 'f', 'u', -50)).toEqual({ included: false });
  });

  it('should return included=true without bucket when percentage >= 100', () => {
    expect(bucketFor('s', 'f', 'u', 100)).toEqual({ included: true });
    expect(bucketFor('s', 'f', 'u', 250)).toEqual({ included: true });
  });

  it('should return included with bucket for intermediate percentages', () => {
    const decision = bucketFor('s', 'f', 'u', 50);
    expect(decision.bucket).toBeDefined();
    expect(typeof decision.bucket).toBe('number');
    expect(typeof decision.included).toBe('boolean');
  });

  it('should produce roughly the requested percentage when sampled across many ids', () => {
    let included = 0;
    const N = 5_000;
    for (let i = 0; i < N; i++) {
      if (bucketFor('salt-v1', 'flagA', `user_${i}`, 25).included) included += 1;
    }
    const pct = (included / N) * 100;
    expect(pct).toBeGreaterThan(20);
    expect(pct).toBeLessThan(30);
  });

  it('should remain stable across repeated calls for the same input', () => {
    const r1 = bucketFor('salt', 'flag', 'user-7', 50);
    const r2 = bucketFor('salt', 'flag', 'user-7', 50);
    expect(r1).toEqual(r2);
  });
});

describe('variantBucketFor', () => {
  it('should always pick a declared variant when weights sum to 100', () => {
    const variants = { a: 50, b: 30, c: 20 };
    for (let i = 0; i < 100; i++) {
      const { variant, bucket } = variantBucketFor('s', 'f', `u_${i}`, variants);
      expect(['a', 'b', 'c']).toContain(variant);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(BUCKET_RESOLUTION);
    }
  });

  it('should distribute roughly proportionally to weights', () => {
    const counts: Record<string, number> = { a: 0, b: 0 };
    const N = 5_000;
    for (let i = 0; i < N; i++) {
      const { variant } = variantBucketFor('s', 'f', `u${i}`, { a: 25, b: 75 });
      counts[variant] = (counts[variant] ?? 0) + 1;
    }
    const ratioA = counts['a']! / N;
    expect(ratioA).toBeGreaterThan(0.2);
    expect(ratioA).toBeLessThan(0.3);
  });

  it('should fall through to the last variant when weights sum below 100', () => {
    const { variant } = variantBucketFor('s', 'f', 'u', { a: 0, last: 0 });
    expect(variant).toBe('last');
  });

  it('should always pick the same variant for the same subjectId', () => {
    const v1 = variantBucketFor('s', 'f', 'stable_u', { a: 33, b: 33, c: 34 });
    const v2 = variantBucketFor('s', 'f', 'stable_u', { a: 33, b: 33, c: 34 });
    expect(v1).toEqual(v2);
  });
});
