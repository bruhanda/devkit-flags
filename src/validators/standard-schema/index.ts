import { FlagsError } from '../../errors/base.js';
import type { StandardSchemaV1 } from '../../types/flag-spec.js';

/**
 * Outcome of a validator invocation. `ok: true` carries the validated
 * value (Standard Schema validators may transform inputs); `ok: false`
 * carries the underlying error so callers can wrap it through
 * `FlagsError('JSON_SCHEMA_ERROR')`.
 */
export type ValidatedResult<TOutput> =
  | { readonly ok: true; readonly value: TOutput }
  | { readonly ok: false; readonly error: FlagsError };

/**
 * Run a Standard-Schema-V1 compatible validator against a candidate
 * value. Wraps every thrown / rejected validator in `FlagsError`
 * (`JSON_SCHEMA_ERROR`) so callers can fall back to the static default
 * without bespoke try/catch code at every JSON-flag boundary.
 *
 * Detection is duck-typed via the `~standard.validate` namespace —
 * Zod, Valibot, and Arktype all expose this signature, so consumers
 * pay zero peer-dep cost.
 *
 * @param schema  A Standard-Schema-V1 validator (e.g. a Zod schema).
 * @param value   The candidate value to validate.
 * @returns       `{ ok: true, value }` on success; otherwise an
 *                `{ ok: false, error }` carrying the underlying issue.
 *
 * @example
 *   const result = await validate(zodSchema, raw);
 *   if (!result.ok) return spec.default;
 *   return result.value;
 */
export async function validate<TOutput>(
  schema: StandardSchemaV1<TOutput>,
  value: unknown,
): Promise<ValidatedResult<TOutput>> {
  if (
    schema === null ||
    typeof schema !== 'object' ||
    schema['~standard'] === undefined ||
    typeof schema['~standard'].validate !== 'function'
  ) {
    return {
      ok: false,
      error: new FlagsError(
        'JSON_SCHEMA_ERROR',
        'value passed to validate() is not a Standard-Schema-V1 validator',
      ),
    };
  }
  try {
    const result = await schema['~standard'].validate(value);
    if ('issues' in result && result.issues !== undefined) {
      return {
        ok: false,
        error: new FlagsError(
          'JSON_SCHEMA_ERROR',
          result.issues.map((i) => i.message).join('; '),
          { context: { issues: result.issues.map((i) => i.message) } },
        ),
      };
    }
    return { ok: true, value: (result as { value: TOutput }).value };
  } catch (cause) {
    return {
      ok: false,
      error: new FlagsError('JSON_SCHEMA_ERROR', 'validator threw', { cause }),
    };
  }
}

/**
 * Synchronous variant — only safe when the validator does not return a
 * promise. Falls back to a synchronous failure when given an async
 * validator (Zod returns sync results unless `.parseAsync` is used).
 *
 * @param schema  A Standard-Schema-V1 validator.
 * @param value   Candidate value.
 * @returns       Synchronous `{ ok, value | error }` result; an async
 *                validator surface returns `{ ok: false }`.
 */
export function validateSync<TOutput>(
  schema: StandardSchemaV1<TOutput>,
  value: unknown,
): ValidatedResult<TOutput> {
  if (
    schema === null ||
    typeof schema !== 'object' ||
    schema['~standard'] === undefined ||
    typeof schema['~standard'].validate !== 'function'
  ) {
    return {
      ok: false,
      error: new FlagsError(
        'JSON_SCHEMA_ERROR',
        'value passed to validateSync() is not a Standard-Schema-V1 validator',
      ),
    };
  }
  try {
    const result = schema['~standard'].validate(value);
    if (result instanceof Promise) {
      return {
        ok: false,
        error: new FlagsError(
          'JSON_SCHEMA_ERROR',
          'validator returned a Promise — use validate() instead of validateSync()',
        ),
      };
    }
    if ('issues' in result && result.issues !== undefined) {
      return {
        ok: false,
        error: new FlagsError(
          'JSON_SCHEMA_ERROR',
          result.issues.map((i) => i.message).join('; '),
          { context: { issues: result.issues.map((i) => i.message) } },
        ),
      };
    }
    return { ok: true, value: (result as { value: TOutput }).value };
  } catch (cause) {
    return {
      ok: false,
      error: new FlagsError('JSON_SCHEMA_ERROR', 'validator threw', { cause }),
    };
  }
}
