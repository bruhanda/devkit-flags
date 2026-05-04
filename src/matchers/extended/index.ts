import { registerMatchers, type MatcherFn } from '../../core/matchers.js';
import type { Json } from '../../types/json.js';

const REGEX_TIMEOUT_MS = 50;
const REGEX_AUTO_DISABLE_THRESHOLD = 5;

interface RegexHealth {
  failures: number;
  disabled: boolean;
}

const regexHealth = new Map<string, RegexHealth>();
const compiledRegexes = new Map<string, RegExp | null>();

const gt: MatcherFn = (expected, actual) =>
  compareScalar(actual, expected) === 'gt';
const gte: MatcherFn = (expected, actual) => {
  const c = compareScalar(actual, expected);
  return c === 'gt' || c === 'eq';
};
const lt: MatcherFn = (expected, actual) =>
  compareScalar(actual, expected) === 'lt';
const lte: MatcherFn = (expected, actual) => {
  const c = compareScalar(actual, expected);
  return c === 'lt' || c === 'eq';
};
const contains: MatcherFn = (expected, actual) =>
  typeof expected === 'string' && typeof actual === 'string' && actual.includes(expected);
const startsWith: MatcherFn = (expected, actual) =>
  typeof expected === 'string' && typeof actual === 'string' && actual.startsWith(expected);
const endsWith: MatcherFn = (expected, actual) =>
  typeof expected === 'string' && typeof actual === 'string' && actual.endsWith(expected);

const customMatcher: MatcherFn = (expected, actual) => {
  if (typeof expected !== 'function') return false;
  // Intentionally do NOT swallow the throw here. `evaluateMatcher` in
  // `core/rules.ts` catches it and forwards to the observability hook
  // with `code: 'RULE_EVAL_ERROR'` so callers can diagnose a buggy
  // `custom` matcher instead of silently treating it as `false`.
  return Boolean((expected as (v: Json | undefined) => boolean)(actual));
};

/**
 * Sandboxed `regex` matcher. Receives the full matcher object (so it
 * can read both `regex` and `flags` keys). Compiles once per
 * `(pattern, flags)` pair, caches in `compiledRegexes`. Per-pattern
 * health is tracked in `regexHealth`; after `REGEX_AUTO_DISABLE_THRESHOLD`
 * cooperative-budget timeouts the pattern is auto-disabled and
 * subsequent matches return `false` until the snapshot reloads.
 */
const regex: MatcherFn = (matcherObject, actual) => {
  if (typeof actual !== 'string') return false;
  if (matcherObject === null || typeof matcherObject !== 'object') return false;
  const m = matcherObject as { regex?: unknown; flags?: unknown };
  if (typeof m.regex !== 'string') return false;
  const flags = typeof m.flags === 'string' ? m.flags : '';
  const cacheKey = `${m.regex}::${flags}`;
  const health = regexHealth.get(cacheKey) ?? { failures: 0, disabled: false };
  if (health.disabled) return false;

  let compiled = compiledRegexes.get(cacheKey);
  if (compiled === undefined) {
    try {
      compiled = new RegExp(m.regex, flags);
    } catch {
      compiled = null;
    }
    compiledRegexes.set(cacheKey, compiled);
  }
  if (compiled === null) return false;

  // Cooperative budget: measure wall-clock around `RegExp.prototype.test`.
  // ReDoS attempts pin the thread well past the budget; the budget catches
  // them on the next sample and counts a failure.
  const start = Date.now();
  let matched = false;
  try {
    matched = compiled.test(actual);
  } catch {
    return false;
  }
  const elapsed = Date.now() - start;
  if (elapsed > REGEX_TIMEOUT_MS) {
    health.failures += 1;
    if (health.failures >= REGEX_AUTO_DISABLE_THRESHOLD) {
      health.disabled = true;
    }
    regexHealth.set(cacheKey, health);
    return false;
  }
  // Reset failure counter on a successful invocation.
  if (health.failures !== 0 || health.disabled) {
    regexHealth.set(cacheKey, { failures: 0, disabled: false });
  }
  return matched;
};

registerMatchers({
  gt,
  gte,
  lt,
  lte,
  contains,
  startsWith,
  endsWith,
  regex,
  custom: customMatcher,
});

/**
 * Reset the regex auto-disable / cache state. Called by the handle's
 * snapshot-reload path so a fixed pattern recovers after the next
 * config update; also exported for tests.
 */
export function resetRegexState(): void {
  regexHealth.clear();
  compiledRegexes.clear();
}

function compareScalar(
  actual: Json | undefined,
  expected: unknown,
): 'gt' | 'lt' | 'eq' | undefined {
  if (actual === undefined || actual === null) return undefined;
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (actual > expected) return 'gt';
    if (actual < expected) return 'lt';
    return 'eq';
  }
  if (typeof actual === 'string' && typeof expected === 'string') {
    if (actual > expected) return 'gt';
    if (actual < expected) return 'lt';
    return 'eq';
  }
  if (typeof actual === 'number' && typeof expected === 'string') {
    const parsed = Number(expected);
    if (!Number.isFinite(parsed)) return undefined;
    if (actual > parsed) return 'gt';
    if (actual < parsed) return 'lt';
    return 'eq';
  }
  if (typeof actual === 'string' && typeof expected === 'number') {
    const parsed = Number(actual);
    if (!Number.isFinite(parsed)) return undefined;
    if (parsed > expected) return 'gt';
    if (parsed < expected) return 'lt';
    return 'eq';
  }
  return undefined;
}
