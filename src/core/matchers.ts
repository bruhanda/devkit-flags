import type { Json } from '../types/json.js';
import type { Operator } from '../types/rules.js';

/**
 * Matcher implementation — pure function that decides whether the
 * rule's expected configuration matches the subject's attribute value.
 *
 * @param expected  The matcher operand shape (e.g. `{ eq: 'pro' }`).
 * @param actual    The subject's attribute value (or `undefined`).
 * @returns         `true` on match.
 */
export type MatcherFn = (expected: unknown, actual: Json | undefined) => boolean;

const registry = new Map<Operator, MatcherFn>();

/**
 * Register matcher implementations against the central registry. Both
 * the core matchers (registered eagerly from `core/matchers.ts`) and
 * the extended matchers (`@devkit/flags/matchers/extended`) flow
 * through this entry point so unknown operators degrade to `false`
 * instead of crashing.
 *
 * @param entries  A `{ operator: matcherFn }` map.
 *
 * @example
 *   registerMatchers({ regex: (e, a) => ... });
 */
export function registerMatchers(entries: Partial<Record<Operator, MatcherFn>>): void {
  for (const [op, fn] of Object.entries(entries)) {
    if (fn !== undefined) registry.set(op as Operator, fn);
  }
}

/** Look up a matcher implementation. Returns `undefined` if unknown. */
export function getMatcher(op: Operator): MatcherFn | undefined {
  return registry.get(op);
}

const eq: MatcherFn = (expected, actual) => deepEqual(expected as Json, actual);
const neq: MatcherFn = (expected, actual) => !deepEqual(expected as Json, actual);
const inMatcher: MatcherFn = (expected, actual) => {
  if (!Array.isArray(expected)) return false;
  if (actual === undefined) return false;
  for (const candidate of expected) {
    if (deepEqual(candidate as Json, actual)) return true;
  }
  return false;
};
const ninMatcher: MatcherFn = (expected, actual) => !inMatcher(expected, actual);
const exists: MatcherFn = (expected, actual) => {
  const want = Boolean(expected);
  const has = actual !== undefined && actual !== null;
  return want ? has : !has;
};

registerMatchers({
  eq,
  neq,
  in: inMatcher,
  nin: ninMatcher,
  exists,
});

/**
 * Structural equality for `Json`. Faster than `JSON.stringify` for the
 * scalar / shallow-array cases that dominate matcher payloads.
 */
function deepEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a === null || b === null) return a === b;
  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return false;
  if (ta !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as { [k: string]: Json };
  const bo = b as { [k: string]: Json };
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}
