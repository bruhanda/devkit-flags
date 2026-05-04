import type { FlagsErrorCode } from './codes.js';

/**
 * The sole error class thrown by the library. Every throwable code
 * path converges through `FlagsError` so consumers can write a single
 * `catch (err) { if (FlagsError.is(err)) ... }` branch.
 *
 * @example
 *   try {
 *     defineFlags({ flags: { x: { kind: 'number', default: NaN } } });
 *   } catch (err) {
 *     if (FlagsError.is(err)) {
 *       console.error(err.code, err.message, err.context);
 *     }
 *   }
 */
export class FlagsError extends Error {
  override readonly name: string = 'FlagsError';
  readonly code: FlagsErrorCode;
  override readonly cause?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;

  constructor(
    code: FlagsErrorCode,
    message: string,
    opts?: { cause?: unknown; context?: Record<string, unknown> },
  ) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.code = code;
    if (opts?.cause !== undefined) {
      this.cause = opts.cause;
    }
    if (opts?.context !== undefined) {
      this.context = Object.freeze({ ...opts.context });
    }
  }

  /**
   * Type-narrowing guard. Inside catch blocks, prefer this over
   * `instanceof FlagsError` — it works across realm boundaries (e.g.
   * worker_threads) where prototype identity may differ.
   */
  static is(err: unknown): err is FlagsError {
    return (
      err instanceof Error &&
      (err as { name?: unknown }).name === 'FlagsError' &&
      typeof (err as { code?: unknown }).code === 'string'
    );
  }
}
