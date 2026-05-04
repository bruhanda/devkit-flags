import { fnv1a32 } from './hash.js';

/** Total bucket precision — `bucket ∈ [0, 10000)`. */
export const BUCKET_RESOLUTION = 10_000;

/**
 * Compute the deterministic bucket integer for a `(salt, flagKey, subjectId)`
 * triple. Same triple → same bucket forever, modulo a salt rotation.
 *
 * @param salt       Per-handle bucketing salt.
 * @param flagKey    The flag's name.
 * @param subjectId  Subject identifier (`''` for anonymous reads).
 * @returns          Integer in `[0, 10000)`.
 *
 * @example
 *   const b = bucketIndex('salt-v1', 'newCheckout', 'user_42'); // e.g. 7531
 */
export function bucketIndex(salt: string, flagKey: string, subjectId: string): number {
  return fnv1a32(`${salt}:${flagKey}:${subjectId}`) % BUCKET_RESOLUTION;
}

/**
 * Decide whether a subject is included in a percentage rollout.
 *
 * Fast paths: `percentage <= 0` returns `{ included: false }` without
 * hashing; `percentage >= 100` returns `{ included: true }` without
 * hashing. Both eliminate work in the production hot path where most
 * flags are either fully-on or fully-off.
 *
 * @param salt        Per-handle bucketing salt.
 * @param bucketKey   Bucketing key — for flag-level rollouts this is
 *                    the flag key; for rule-level rollouts it is
 *                    `${flagKey}:${ruleId}` so two rules in the same
 *                    flag produce independent buckets.
 * @param subjectId   Subject identifier.
 * @param percentage  Target percentage (`0..100`); values outside the
 *                    range are clamped to the nearest bound.
 * @returns           `{ included, bucket }` — `bucket` is `undefined`
 *                    on the trivial 0/100 fast paths.
 *
 * @example
 *   const decision = bucketFor('salt-v1', 'newCheckout', 'user_42', 25);
 *   if (decision.included) enableNewCheckout();
 */
export function bucketFor(
  salt: string,
  bucketKey: string,
  subjectId: string,
  percentage: number,
): { included: boolean; bucket?: number } {
  if (percentage <= 0) return { included: false };
  if (percentage >= 100) return { included: true };
  const bucket = bucketIndex(salt, bucketKey, subjectId);
  const threshold = Math.round(percentage * (BUCKET_RESOLUTION / 100));
  return { included: bucket < threshold, bucket };
}

/**
 * Choose a multivariate variant for a subject. Weights are
 * pre-validated to sum to 100 at config time; this runtime path does
 * NOT re-validate (perf-critical).
 *
 * @param salt        Per-handle bucketing salt.
 * @param bucketKey   Bucketing key.
 * @param subjectId   Subject identifier.
 * @param variants    Map of `{ variantName: weight }` — weights sum to 100.
 * @returns           `{ variant, bucket }` — the chosen variant name
 *                    and the bucket integer (always present).
 *
 * @example
 *   const { variant } = variantBucketFor('salt', 'flag', 'u1',
 *     { a: 50, b: 30, c: 20 });
 */
export function variantBucketFor(
  salt: string,
  bucketKey: string,
  subjectId: string,
  variants: Readonly<Record<string, number>>,
): { variant: string; bucket: number } {
  const bucket = bucketIndex(salt, bucketKey, subjectId);
  let cumulative = 0;
  let lastName = '';
  for (const [name, weight] of Object.entries(variants)) {
    lastName = name;
    cumulative += Math.round(weight * (BUCKET_RESOLUTION / 100));
    if (bucket < cumulative) return { variant: name, bucket };
  }
  return { variant: lastName, bucket };
}
