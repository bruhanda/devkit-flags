import { FlagsError } from '../errors/base.js';
import type { FlagSchema } from '../types/flag-schema.js';
import type { FlagSpec, NumberFlagSpec, StringFlagSpec } from '../types/flag-spec.js';
import type { Rollout } from '../types/rules.js';
import { invariant } from './invariant.js';

const VALID_KINDS = new Set(['boolean', 'string', 'number', 'json']);

/**
 * Validate a `FlagSchema` at construction time. Throws `INVALID_SCHEMA`
 * on malformed shapes — misconfiguration must surface during boot, not
 * at the first user request.
 *
 * Checks:
 *   - flag `kind` is one of the four supported kinds
 *   - `string` flag `default` is in `values` when the latter is supplied
 *   - `number` flag `range` is a 2-tuple with `min <= max`
 *   - rule `value`s match the flag's `kind`
 *   - rollout `percentage` is in `[0, 100]`
 *   - rollout `variants` weights sum to 100 (±0.001 for FP slop)
 *   - multivariate rollout keys are in the `string`-flag value set
 *     when present
 *
 * @param schema  The user-supplied schema.
 * @throws        `FlagsError('INVALID_SCHEMA')` on any violation.
 */
export function validateSchema(schema: FlagSchema): void {
  for (const [key, spec] of Object.entries(schema)) {
    invariant(
      spec !== null && typeof spec === 'object',
      'INVALID_SCHEMA',
      `flag "${key}": spec must be an object`,
    );
    invariant(
      VALID_KINDS.has(spec.kind),
      'INVALID_SCHEMA',
      `flag "${key}": unknown kind "${String(spec.kind)}"`,
    );
    validateDefault(key, spec);
    validateRules(key, spec);
    if (spec.rollout !== undefined) {
      validateRollout(key, spec, spec.rollout as unknown as Rollout<unknown>);
    }
  }
}

function validateDefault(key: string, spec: FlagSpec): void {
  switch (spec.kind) {
    case 'boolean':
      invariant(
        typeof spec.default === 'boolean',
        'INVALID_SCHEMA',
        `flag "${key}": default must be boolean`,
      );
      return;
    case 'string': {
      const stringSpec = spec as StringFlagSpec;
      invariant(
        typeof stringSpec.default === 'string',
        'INVALID_SCHEMA',
        `flag "${key}": default must be string`,
      );
      if (stringSpec.values !== undefined) {
        invariant(
          stringSpec.values.includes(stringSpec.default),
          'INVALID_SCHEMA',
          `flag "${key}": default "${stringSpec.default}" not in values`,
        );
      }
      return;
    }
    case 'number': {
      const numberSpec = spec as NumberFlagSpec;
      invariant(
        typeof numberSpec.default === 'number' && Number.isFinite(numberSpec.default),
        'INVALID_SCHEMA',
        `flag "${key}": default must be a finite number`,
      );
      if (numberSpec.range !== undefined) {
        invariant(
          Array.isArray(numberSpec.range) && numberSpec.range.length === 2,
          'INVALID_SCHEMA',
          `flag "${key}": range must be a 2-tuple`,
        );
        const [min, max] = numberSpec.range;
        invariant(
          Number.isFinite(min) && Number.isFinite(max) && min <= max,
          'INVALID_SCHEMA',
          `flag "${key}": range bounds must be finite and min <= max`,
        );
      }
      return;
    }
    case 'json':
      // any JSON-shaped value is acceptable
      return;
  }
}

function validateRules(key: string, spec: FlagSpec): void {
  if (spec.rules === undefined) return;
  for (let i = 0; i < spec.rules.length; i++) {
    const rule = spec.rules[i];
    if (rule === undefined) continue;
    if (rule.value !== undefined) {
      validateValueKind(`flag "${key}" rules[${i}].value`, rule.value, spec.kind);
      if (spec.kind === 'string') {
        const stringSpec = spec as StringFlagSpec;
        if (stringSpec.values !== undefined) {
          invariant(
            stringSpec.values.includes(rule.value as string),
            'INVALID_SCHEMA',
            `flag "${key}" rules[${i}]: value "${String(rule.value)}" not in declared values`,
          );
        }
      }
    }
    if (rule.rollout !== undefined) {
      validateRollout(key, spec, rule.rollout as unknown as Rollout<unknown>);
    }
  }
}

function validateRollout(key: string, spec: FlagSpec, rollout: Rollout<unknown>): void {
  if ('percentage' in rollout) {
    invariant(
      Number.isFinite(rollout.percentage) &&
        rollout.percentage >= 0 &&
        rollout.percentage <= 100,
      'INVALID_SCHEMA',
      `flag "${key}": rollout.percentage must be in [0, 100]`,
    );
    return;
  }
  if ('variants' in rollout) {
    const variants = rollout.variants as Record<string, number>;
    const entries = Object.entries(variants);
    invariant(
      entries.length > 0,
      'INVALID_SCHEMA',
      `flag "${key}": rollout.variants cannot be empty`,
    );
    let sum = 0;
    for (const [name, weight] of entries) {
      invariant(
        Number.isFinite(weight) && weight >= 0 && weight <= 100,
        'INVALID_SCHEMA',
        `flag "${key}": variant "${name}" weight must be in [0, 100]`,
      );
      sum += weight;
    }
    invariant(
      Math.abs(sum - 100) < 0.001,
      'INVALID_SCHEMA',
      `flag "${key}": rollout.variants weights must sum to 100 (got ${sum})`,
    );
    if (spec.kind === 'string') {
      const stringSpec = spec as StringFlagSpec;
      if (stringSpec.values !== undefined) {
        for (const name of Object.keys(variants)) {
          invariant(
            stringSpec.values.includes(name),
            'INVALID_SCHEMA',
            `flag "${key}": variant "${name}" not in declared values`,
          );
        }
      }
    }
    return;
  }
  throw new FlagsError(
    'INVALID_SCHEMA',
    `flag "${key}": rollout must have either "percentage" or "variants"`,
  );
}

function validateValueKind(
  label: string,
  value: unknown,
  kind: FlagSpec['kind'],
): void {
  switch (kind) {
    case 'boolean':
      invariant(typeof value === 'boolean', 'INVALID_SCHEMA', `${label} must be boolean`);
      return;
    case 'string':
      invariant(typeof value === 'string', 'INVALID_SCHEMA', `${label} must be string`);
      return;
    case 'number':
      invariant(
        typeof value === 'number' && Number.isFinite(value),
        'INVALID_SCHEMA',
        `${label} must be a finite number`,
      );
      return;
    case 'json':
      // any JSON value is acceptable
      return;
  }
}
