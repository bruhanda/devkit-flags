import type { Json } from '../types/json.js';
import type { EvaluationContext } from '../types/context.js';
import type { Matcher, Operator, RuleGroup } from '../types/rules.js';
import { getMatcher } from './matchers.js';

const SPECIAL_KEYS = new Set(['$and', '$or', '$not', '$segment']);

/**
 * Walk a `RuleGroup` against the supplied evaluation context. Returns
 * `true` when the group matches.
 *
 * Composition forms:
 *   - `{ $and: [...] }` — all children must match.
 *   - `{ $or:  [...] }` — at least one child must match.
 *   - `{ $not: G }`     — child must NOT match.
 *   - `{ $segment: 'name' }` — references a named group from `segments`.
 *   - `{ attr: { op: ... }, ... }` — implicit-AND map of attribute matchers.
 *
 * @param group     The rule group.
 * @param context   The evaluation context.
 * @param segments  Map of named groups for `{ $segment }` resolution.
 * @returns         `true` when the group matches.
 *
 * @example
 *   const ok = matchRule(
 *     { plan: { in: ['pro','enterprise'] } } as RuleGroup,
 *     { subject: { id: 'u1', attributes: { plan: 'pro' } } },
 *   );
 */
export function matchRule(
  group: RuleGroup,
  context: EvaluationContext,
  segments?: Readonly<Record<string, RuleGroup>>,
): boolean {
  const obj = group as unknown as Record<string, unknown>;
  if (Array.isArray(obj['$and'])) {
    for (const child of obj['$and']) {
      if (!matchRule(child as RuleGroup, context, segments)) return false;
    }
    return true;
  }
  if (Array.isArray(obj['$or'])) {
    for (const child of obj['$or']) {
      if (matchRule(child as RuleGroup, context, segments)) return true;
    }
    return false;
  }
  if (obj['$not'] !== undefined) {
    return !matchRule(obj['$not'] as RuleGroup, context, segments);
  }
  if (typeof obj['$segment'] === 'string') {
    const referenced = segments?.[obj['$segment']];
    if (referenced === undefined) return false;
    return matchRule(referenced, context, segments);
  }
  // Implicit-AND map: every attribute → matcher pair must match.
  const attributes = context.subject?.attributes;
  for (const [attrName, matcher] of Object.entries(obj)) {
    if (SPECIAL_KEYS.has(attrName)) continue;
    if (matcher === undefined) continue;
    const actual = attributes?.[attrName] as Json | undefined;
    if (!evaluateMatcher(matcher as Matcher, actual)) return false;
  }
  return true;
}

/**
 * Run a single matcher against an attribute value. Looks up the
 * operator implementation from the central registry. Unknown
 * operators (or matcher-execution exceptions) degrade to `false` —
 * the calling rule fails the match without taking down the request.
 */
function evaluateMatcher(matcher: Matcher, actual: Json | undefined): boolean {
  const entries = Object.entries(matcher as Record<string, unknown>);
  if (entries.length === 0) return false;
  for (const [op, expected] of entries) {
    if (op === 'flags') continue;
    const fn = getMatcher(op as Operator);
    if (fn === undefined) return false;
    try {
      if (op === 'regex') {
        // The `regex` operator carries `flags` alongside its `regex`
        // key — pass the full matcher so the implementation can read
        // both.
        if (!fn(matcher as unknown, actual)) return false;
        return true;
      }
      if (!fn(expected, actual)) return false;
    } catch {
      return false;
    }
  }
  return true;
}
