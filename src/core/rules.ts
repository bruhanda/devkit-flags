import type { Json } from '../types/json.js';
import type { EvaluationContext } from '../types/context.js';
import type { Matcher, Operator, RuleGroup } from '../types/rules.js';
import { getMatcher } from './matchers.js';

const SPECIAL_KEYS = new Set(['$and', '$or', '$not', '$segment']);

/**
 * Reported when a matcher throws or a `$segment` cycle is detected.
 * Receives the offending segment / operator name so the handle can
 * forward to the observability hook with `code: 'RULE_EVAL_ERROR'`.
 */
export type RuleEvalErrorReporter = (info: {
  readonly kind: 'segment-cycle' | 'matcher-throw';
  readonly name: string;
  readonly cause?: unknown;
}) => void;

interface MatchOptions {
  readonly segments?: Readonly<Record<string, RuleGroup>>;
  readonly inFlightSegments?: Set<string>;
  readonly reportError?: RuleEvalErrorReporter;
}

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
 * Cycle protection: an in-flight segment set is threaded through the
 * recursion. Re-entering a segment (`A` → `B` → `A`) reports
 * `RULE_EVAL_ERROR` via `reportError` and returns `false`.
 *
 * @param group     The rule group.
 * @param context   The evaluation context.
 * @param options   Segments map, cycle-tracker, and error reporter.
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
  options?: MatchOptions | Readonly<Record<string, RuleGroup>>,
): boolean {
  const opts: MatchOptions = isMatchOptions(options)
    ? options
    : options !== undefined
      ? { segments: options }
      : {};
  return matchRuleInner(group, context, opts);
}

function matchRuleInner(
  group: RuleGroup,
  context: EvaluationContext,
  opts: MatchOptions,
): boolean {
  const obj = group as unknown as Record<string, unknown>;
  if (Array.isArray(obj['$and'])) {
    for (const child of obj['$and']) {
      if (!matchRuleInner(child as RuleGroup, context, opts)) return false;
    }
    return true;
  }
  if (Array.isArray(obj['$or'])) {
    for (const child of obj['$or']) {
      if (matchRuleInner(child as RuleGroup, context, opts)) return true;
    }
    return false;
  }
  if (obj['$not'] !== undefined) {
    return !matchRuleInner(obj['$not'] as RuleGroup, context, opts);
  }
  if (typeof obj['$segment'] === 'string') {
    const name = obj['$segment'];
    const referenced = opts.segments?.[name];
    if (referenced === undefined) return false;
    const inFlight = opts.inFlightSegments ?? new Set<string>();
    if (inFlight.has(name)) {
      opts.reportError?.({ kind: 'segment-cycle', name });
      return false;
    }
    inFlight.add(name);
    try {
      return matchRuleInner(referenced, context, { ...opts, inFlightSegments: inFlight });
    } finally {
      inFlight.delete(name);
    }
  }
  // Implicit-AND map: every attribute → matcher pair must match.
  const attributes = context.subject?.attributes;
  for (const [attrName, matcher] of Object.entries(obj)) {
    if (SPECIAL_KEYS.has(attrName)) continue;
    if (matcher === undefined) continue;
    const actual = attributes?.[attrName] as Json | undefined;
    if (!evaluateMatcher(matcher as Matcher, actual, opts.reportError)) return false;
  }
  return true;
}

function isMatchOptions(
  v: MatchOptions | Readonly<Record<string, RuleGroup>> | undefined,
): v is MatchOptions {
  if (v === undefined) return false;
  return (
    'segments' in v ||
    'inFlightSegments' in v ||
    'reportError' in v
  );
}

/**
 * Run a single matcher against an attribute value. Looks up the
 * operator implementation from the central registry.
 *
 * - Unknown operators degrade to `false`. (Parse-time validation
 *   catches typos in JSON; runtime fall-through covers extension
 *   operators that haven't been registered yet.)
 * - A throwing matcher (typically a user `custom` callback) is
 *   surfaced to the observability hook via `reportError` with
 *   `RULE_EVAL_ERROR` and the match returns `false`. We never let
 *   a user matcher take down a request.
 */
function evaluateMatcher(
  matcher: Matcher,
  actual: Json | undefined,
  reportError?: RuleEvalErrorReporter,
): boolean {
  const entries = Object.entries(matcher as Record<string, unknown>);
  if (entries.length === 0) return false;
  for (const [op, expected] of entries) {
    if (op === 'flags') continue;
    const fn = getMatcher(op as Operator);
    if (fn === undefined) return false;
    try {
      const ok =
        op === 'regex' ? fn(matcher as unknown, actual) : fn(expected, actual);
      if (!ok) return false;
    } catch (cause) {
      reportError?.({ kind: 'matcher-throw', name: op, cause });
      return false;
    }
  }
  return true;
}
