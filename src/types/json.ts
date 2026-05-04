/**
 * JSON-compatible value. Recursive — `Json` may be a primitive,
 * an array of `Json`, or an object whose values are `Json`.
 *
 * Used as the raw value type at every JSON / env / remote
 * boundary, and as the fallback shape for `JsonFlagSpec` when
 * no Standard-Schema validator is supplied.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json };

/**
 * Anything serialisable to JSON. Equivalent to `Json` plus
 * `undefined` (which is normalised away on serialisation).
 */
export type Jsonable = Json | undefined;
