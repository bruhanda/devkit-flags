import { FlagsError } from '../errors/base.js';
import type { FlagsErrorCode } from '../errors/codes.js';

/**
 * Throw a `FlagsError` with the given code when `condition` is falsy.
 * Used at config boundaries — never on hot paths (every evaluation-time
 * error becomes an `EvaluationResult` with `reason: 'ERROR'`).
 *
 * @param condition  The invariant. Throws when falsy.
 * @param code       The error code to attach (see `FLAGS_ERROR_CODES`).
 * @param message    Human-readable error message.
 * @param context    Optional structured context for diagnostics.
 * @throws  `FlagsError` when `condition` is falsy.
 *
 * @example
 *   invariant(spec.kind === 'boolean', 'INVALID_SCHEMA', 'expected boolean');
 */
export function invariant(
  condition: unknown,
  code: FlagsErrorCode,
  message: string,
  context?: Record<string, unknown>,
): asserts condition {
  if (!condition) {
    throw new FlagsError(code, message, context !== undefined ? { context } : undefined);
  }
}
