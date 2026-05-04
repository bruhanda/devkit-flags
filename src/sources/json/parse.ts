import { FlagsError } from '../../errors/base.js';
import type { FlagSpec } from '../../types/flag-spec.js';
import type { Json } from '../../types/json.js';
import type { Matcher, Operator, Rollout, Rule, RuleGroup } from '../../types/rules.js';

/** On-disk JSON shape parsed by `parseFlagsJson`. */
export interface FlagsJson {
  readonly $schema?: string;
  readonly flags: Readonly<Record<string, unknown>>;
  readonly environments?: readonly string[];
  readonly segments?: Readonly<Record<string, unknown>>;
}

/** Result of `parseFlagsJson`. */
export interface ParsedFlagsJson {
  readonly flags: Readonly<Record<string, FlagSpec>>;
  readonly segments: Readonly<Record<string, RuleGroup>>;
}

const KNOWN_TOP_LEVEL = new Set(['$schema', 'flags', 'environments', 'segments']);
const KNOWN_KINDS = new Set(['boolean', 'string', 'number', 'json']);
const REGEX_LITERAL_MAX = 1024;
const REGEX_LOOKBEHIND_MAX_DEPTH = 3;

// Every matcher operator that may legitimately appear in JSON. `custom`
// is intentionally absent — it is hard-rejected with
// `UNSAFE_MATCHER_FROM_JSON` because its `(value) => boolean` callback
// shape is unrepresentable in JSON. `flags` is recognised as a sibling
// modifier of `regex`, not a standalone op.
const KNOWN_MATCHER_OPS = new Set<Operator>([
  'eq',
  'neq',
  'in',
  'nin',
  'exists',
  'gt',
  'gte',
  'lt',
  'lte',
  'regex',
  'contains',
  'startsWith',
  'endsWith',
]);

// Keys that mutate the prototype chain on V8 if assigned via bracket
// notation. Filtered at every untrusted-JSON boundary so a remote
// payload cannot pollute `Object.prototype`.
const PROTO_BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validate-and-parse a `FlagsJson` payload. Returns the typed
 * snapshot fragments ready to feed `composeSources`.
 *
 * Trust boundary: this function is the only path between an
 * untrusted CDN / remote payload and the runtime evaluator. It
 * enforces three security properties:
 *
 *   1. `custom` matchers are hard-rejected (`UNSAFE_MATCHER_FROM_JSON`)
 *      because the `(value) => boolean` callback shape is unrepresentable
 *      in JSON; pre-empts a future "function-string" loader RCE.
 *   2. `regex` matchers are bounded — pattern length ≤ 1024,
 *      lookbehind nesting ≤ 3.
 *   3. `{ $segment: 'name' }` references must resolve at parse time.
 *
 * @param raw  Either a parsed object or a raw JSON string. Strings
 *             are parsed via `JSON.parse`; failures wrap as
 *             `FlagsError('JSON_PARSE_ERROR')` with the cause.
 * @returns    A `{ flags, segments }` pair ready for the snapshot.
 * @throws     `FlagsError('JSON_PARSE_ERROR' | 'INVALID_SCHEMA' |
 *             'UNSAFE_MATCHER_FROM_JSON')`.
 */
export function parseFlagsJson(raw: string | unknown): ParsedFlagsJson {
  const data = typeof raw === 'string' ? safeParse(raw) : raw;
  invariantObj(data, 'JSON payload must be an object');

  for (const key of Object.keys(data)) {
    if (!KNOWN_TOP_LEVEL.has(key)) {
      throw new FlagsError(
        'INVALID_SCHEMA',
        `unknown top-level field "${key}" in flags.json`,
      );
    }
  }

  const json = data as FlagsJson;
  invariantObj(json.flags, 'flags.json must declare a "flags" object');

  // Two-pass: parse segment names first so we can validate
  // `{ $segment: 'name' }` references during flag parsing.
  const segments: Record<string, RuleGroup> = Object.create(null);
  if (json.segments !== undefined) {
    invariantObj(json.segments, 'segments must be an object');
    for (const name of Object.keys(json.segments)) {
      assertSafeKey('segments', name);
      // pre-register names; populate after.
      segments[name] = {} as RuleGroup;
    }
  }

  if (json.segments !== undefined) {
    for (const [name, group] of Object.entries(json.segments)) {
      segments[name] = parseRuleGroup(`segments.${name}`, group, segments);
    }
  }

  const flags: Record<string, FlagSpec> = Object.create(null);
  for (const [key, entry] of Object.entries(json.flags)) {
    assertSafeKey('flags', key);
    flags[key] = parseFlagEntry(key, entry, segments);
  }

  return { flags, segments };
}

function assertSafeKey(scope: string, key: string): void {
  if (PROTO_BLOCKED_KEYS.has(key)) {
    throw new FlagsError(
      'INVALID_SCHEMA',
      `${scope}: key "${key}" is reserved and cannot appear in JSON`,
    );
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new FlagsError('JSON_PARSE_ERROR', 'malformed flags JSON', { cause });
  }
}

function parseFlagEntry(
  key: string,
  entry: unknown,
  segments: Record<string, RuleGroup>,
): FlagSpec {
  invariantObj(entry, `flag "${key}": entry must be an object`);
  const spec = entry as Record<string, unknown>;
  const kind = spec['kind'];
  if (typeof kind !== 'string' || !KNOWN_KINDS.has(kind)) {
    throw new FlagsError(
      'INVALID_SCHEMA',
      `flag "${key}": kind must be one of boolean|string|number|json`,
    );
  }
  const base: Record<string, unknown> = Object.create(null);
  base['kind'] = kind;
  base['default'] = spec['default'];
  if (typeof spec['description'] === 'string') {
    base['description'] = spec['description'];
  }
  if (Array.isArray(spec['tags'])) {
    base['tags'] = spec['tags'].filter((t) => typeof t === 'string');
  }
  if (typeof spec['deprecated'] === 'boolean') {
    base['deprecated'] = spec['deprecated'];
  }
  if (spec['environments'] !== undefined) {
    invariantObj(spec['environments'], `flag "${key}": environments must be an object`);
    const envMap: Record<string, unknown> = Object.create(null);
    for (const [envKey, envValue] of Object.entries(
      spec['environments'] as Record<string, unknown>,
    )) {
      if (PROTO_BLOCKED_KEYS.has(envKey)) continue;
      envMap[envKey] = envValue;
    }
    base['environments'] = envMap;
  }
  if (kind === 'string') {
    if (Array.isArray(spec['values'])) {
      const values = spec['values'].filter((v): v is string => typeof v === 'string');
      (base as { values?: readonly string[] }).values = values;
    }
  }
  if (kind === 'number') {
    if (Array.isArray(spec['range'])) {
      const range = spec['range'];
      if (range.length !== 2 || typeof range[0] !== 'number' || typeof range[1] !== 'number') {
        throw new FlagsError(
          'INVALID_SCHEMA',
          `flag "${key}": range must be [min, max] of numbers`,
        );
      }
      (base as { range?: readonly [number, number] }).range = [
        range[0],
        range[1],
      ] as const;
    }
  }
  if (Array.isArray(spec['rules'])) {
    base['rules'] = spec['rules'].map((rule, i) =>
      parseRule(`flag "${key}" rules[${i}]`, rule, segments),
    );
  }
  if (spec['rollout'] !== undefined) {
    base['rollout'] = parseRollout(`flag "${key}" rollout`, spec['rollout']);
  }
  return base as unknown as FlagSpec;
}

function parseRule(
  label: string,
  raw: unknown,
  segments: Record<string, RuleGroup>,
): Rule<unknown> {
  invariantObj(raw, `${label}: rule must be an object`);
  const rule = raw as Record<string, unknown>;
  const out: Record<string, unknown> = Object.create(null);
  if (typeof rule['id'] === 'string') out['id'] = rule['id'];
  if (typeof rule['description'] === 'string') out['description'] = rule['description'];
  if (rule['when'] !== undefined) {
    out['when'] = parseRuleGroup(`${label}.when`, rule['when'], segments);
  }
  if (rule['value'] !== undefined) out['value'] = rule['value'];
  if (rule['rollout'] !== undefined) {
    out['rollout'] = parseRollout(`${label}.rollout`, rule['rollout']);
  }
  return out as Rule<unknown>;
}

function parseRuleGroup(
  label: string,
  raw: unknown,
  segments: Record<string, RuleGroup>,
): RuleGroup {
  invariantObj(raw, `${label}: rule group must be an object`);
  const group = raw as Record<string, unknown>;
  const keys = Object.keys(group);
  if (keys.includes('$and')) {
    const arr = group['$and'];
    if (!Array.isArray(arr)) {
      throw new FlagsError('INVALID_SCHEMA', `${label}: $and must be an array`);
    }
    return {
      $and: arr.map((g, i) => parseRuleGroup(`${label}.$and[${i}]`, g, segments)),
    };
  }
  if (keys.includes('$or')) {
    const arr = group['$or'];
    if (!Array.isArray(arr)) {
      throw new FlagsError('INVALID_SCHEMA', `${label}: $or must be an array`);
    }
    return {
      $or: arr.map((g, i) => parseRuleGroup(`${label}.$or[${i}]`, g, segments)),
    };
  }
  if (keys.includes('$not')) {
    return {
      $not: parseRuleGroup(`${label}.$not`, group['$not'], segments),
    };
  }
  if (keys.includes('$segment')) {
    const name = group['$segment'];
    if (typeof name !== 'string') {
      throw new FlagsError(
        'INVALID_SCHEMA',
        `${label}: $segment must be a string name`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(segments, name)) {
      throw new FlagsError(
        'INVALID_SCHEMA',
        `${label}: $segment "${name}" is not declared`,
      );
    }
    return { $segment: name };
  }
  // Implicit-AND map of attribute matchers.
  const out: Record<string, Matcher> = Object.create(null);
  for (const [attr, matcher] of Object.entries(group)) {
    if (PROTO_BLOCKED_KEYS.has(attr)) continue;
    out[attr] = parseMatcher(`${label}.${attr}`, matcher);
  }
  return out as unknown as RuleGroup;
}

function parseMatcher(label: string, raw: unknown): Matcher {
  invariantObj(raw, `${label}: matcher must be an object`);
  const m = raw as Record<string, Json>;
  if ('custom' in m) {
    throw new FlagsError(
      'UNSAFE_MATCHER_FROM_JSON',
      `${label}: "custom" matchers cannot be loaded from JSON / remote sources`,
    );
  }
  // Reject unknown operators at parse time. Catches typos like
  // `{ equals: 'pro' }` instead of `{ eq: 'pro' }` that would
  // otherwise ship to production and silently match nobody.
  for (const op of Object.keys(m)) {
    if (op === 'flags' && 'regex' in m) continue;
    if (!KNOWN_MATCHER_OPS.has(op as Operator)) {
      throw new FlagsError(
        'INVALID_SCHEMA',
        `${label}: unknown matcher operator "${op}"`,
      );
    }
  }
  if ('regex' in m) {
    const pattern = m['regex'];
    if (typeof pattern !== 'string') {
      throw new FlagsError('INVALID_SCHEMA', `${label}: regex must be a string`);
    }
    if (pattern.length > REGEX_LITERAL_MAX) {
      throw new FlagsError(
        'INVALID_SCHEMA',
        `${label}: regex literal exceeds ${REGEX_LITERAL_MAX} chars`,
      );
    }
    if (!isLookbehindWithinBudget(pattern)) {
      throw new FlagsError(
        'INVALID_SCHEMA',
        `${label}: regex lookbehind nesting exceeds ${REGEX_LOOKBEHIND_MAX_DEPTH}`,
      );
    }
    const flags = m['flags'];
    if (flags !== undefined && typeof flags !== 'string') {
      throw new FlagsError('INVALID_SCHEMA', `${label}: regex flags must be a string`);
    }
    return flags !== undefined
      ? { regex: pattern, flags }
      : { regex: pattern };
  }
  return m as Matcher;
}

function parseRollout(label: string, raw: unknown): Rollout<unknown> {
  invariantObj(raw, `${label}: rollout must be an object`);
  const rollout = raw as Record<string, unknown>;
  if ('percentage' in rollout) {
    const pct = rollout['percentage'];
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new FlagsError(
        'INVALID_SCHEMA',
        `${label}: percentage must be a number in [0, 100]`,
      );
    }
    return { percentage: pct };
  }
  if ('variants' in rollout) {
    invariantObj(rollout['variants'], `${label}: variants must be an object`);
    const out: Record<string, number> = Object.create(null);
    for (const [name, weight] of Object.entries(
      rollout['variants'] as Record<string, unknown>,
    )) {
      if (PROTO_BLOCKED_KEYS.has(name)) continue;
      if (typeof weight !== 'number' || !Number.isFinite(weight)) {
        throw new FlagsError(
          'INVALID_SCHEMA',
          `${label}: variant "${name}" weight must be a finite number`,
        );
      }
      out[name] = weight;
    }
    return { variants: out };
  }
  throw new FlagsError(
    'INVALID_SCHEMA',
    `${label}: rollout must specify "percentage" or "variants"`,
  );
}

function invariantObj(value: unknown, message: string): asserts value is object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new FlagsError('INVALID_SCHEMA', message);
  }
}

function isLookbehindWithinBudget(pattern: string): boolean {
  let depth = 0;
  let max = 0;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\' && i + 1 < pattern.length) {
      i++;
      continue;
    }
    if (
      pattern[i] === '(' &&
      pattern[i + 1] === '?' &&
      pattern[i + 2] === '<' &&
      (pattern[i + 3] === '=' || pattern[i + 3] === '!')
    ) {
      depth++;
      if (depth > max) max = depth;
    }
    if (pattern[i] === ')') {
      if (depth > 0) depth--;
    }
  }
  return max <= REGEX_LOOKBEHIND_MAX_DEPTH;
}
