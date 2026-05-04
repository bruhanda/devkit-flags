import { FlagsError } from '../errors/base.js';
import { deepFreeze } from '../utils/freeze.js';
import type { FlagKind } from '../types/flag-kind.js';
import type { Json } from '../types/json.js';

const TRUE_TOKENS = new Set(['true', '1', 'on', 'yes']);
const FALSE_TOKENS = new Set(['false', '0', 'off', 'no', '']);

/**
 * Coerce a possibly-string raw value (env-var, JSON literal, remote
 * payload) to the declared `FlagKind`'s value type. Throws
 * `FlagsError('TYPE_MISMATCH')` on unrepresentable values; the caller
 * is responsible for falling back to the static default.
 *
 * @param raw   The candidate value.
 * @param kind  The declared flag kind.
 * @returns     The coerced value, typed against `kind`.
 * @throws      `FlagsError('TYPE_MISMATCH')` when `raw` cannot be coerced.
 *
 * @example
 *   coerce('true', 'boolean')   // -> true
 *   coerce('  42 ', 'number')   // -> 42
 *   coerce('{"a":1}', 'json')   // -> { a: 1 }
 */
export function coerce(raw: unknown, kind: FlagKind): Json | boolean | number | string {
  switch (kind) {
    case 'boolean':
      return coerceBoolean(raw);
    case 'number':
      return coerceNumber(raw);
    case 'string':
      return coerceString(raw);
    case 'json':
      return coerceJson(raw);
    default: {
      const exhaustive: never = kind;
      throw new FlagsError('TYPE_MISMATCH', `unknown kind: ${String(exhaustive)}`);
    }
  }
}

function coerceBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw !== 0;
  if (typeof raw === 'string') {
    const token = raw.trim().toLowerCase();
    if (TRUE_TOKENS.has(token)) return true;
    if (FALSE_TOKENS.has(token)) return false;
  }
  throw new FlagsError('TYPE_MISMATCH', `cannot coerce ${stringify(raw)} to boolean`);
}

function coerceNumber(raw: unknown): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new FlagsError('TYPE_MISMATCH', `non-finite number: ${String(raw)}`);
    }
    return raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') {
      throw new FlagsError('TYPE_MISMATCH', 'empty string is not a number');
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  throw new FlagsError('TYPE_MISMATCH', `cannot coerce ${stringify(raw)} to number`);
}

function coerceString(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  throw new FlagsError('TYPE_MISMATCH', `cannot coerce ${stringify(raw)} to string`);
}

function coerceJson(raw: unknown): Json {
  if (raw === null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed === 'null') {
      try {
        return deepFreeze(JSON.parse(trimmed) as Json);
      } catch (cause) {
        throw new FlagsError('TYPE_MISMATCH', 'invalid JSON literal', { cause });
      }
    }
    return raw;
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
  if (Array.isArray(raw) || (typeof raw === 'object' && raw !== null)) {
    // Freeze the returned reference so a consumer mutating the object
    // they got from `flags.get('jsonFlag')` cannot retroactively change
    // the underlying `FlagSpec.default` for every other reader.
    return deepFreeze(raw as Json);
  }
  throw new FlagsError('TYPE_MISMATCH', `cannot coerce ${stringify(raw)} to json`);
}

/**
 * Clamp a number into an inclusive `[min, max]` range.
 *
 * @param value  Raw number.
 * @param range  Inclusive `[min, max]` bounds.
 * @returns      `value`, clamped to the range.
 */
export function clampNumber(value: number, range: readonly [number, number]): number {
  const [min, max] = range;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function stringify(raw: unknown): string {
  try {
    return JSON.stringify(raw) ?? String(raw);
  } catch {
    return Object.prototype.toString.call(raw);
  }
}
