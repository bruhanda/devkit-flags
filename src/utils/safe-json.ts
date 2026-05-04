/**
 * Result of a `parseJson` call. `ok: true` carries the parsed value;
 * `ok: false` carries the underlying `SyntaxError` (or other thrown
 * value) so callers can wrap it in a `FlagsError`.
 */
export type ParseJsonResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

/**
 * Parse a JSON string without throwing. Returns a `Result`-shaped
 * discriminated union the caller can branch on.
 *
 * @typeParam T  Caller's expected output shape — not validated; treat
 *               as a hint, not a guarantee.
 * @param raw    The raw JSON text.
 * @returns      `{ ok: true, value }` on success; `{ ok: false, error }`
 *               on parse failure.
 *
 * @example
 *   const result = parseJson<{ flags: Record<string, unknown> }>(text);
 *   if (!result.ok) {
 *     throw new FlagsError('JSON_PARSE_ERROR', 'malformed JSON', { cause: result.error });
 *   }
 */
export function parseJson<T>(raw: string): ParseJsonResult<T> {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch (error) {
    return { ok: false, error };
  }
}
