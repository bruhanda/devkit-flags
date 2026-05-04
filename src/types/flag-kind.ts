import type { Json } from './json.js';

/**
 * The four supported flag value kinds. Used as the discriminant on
 * `FlagSpec` so `flags.get(key)` narrows to the correct value type.
 */
export type FlagKind = 'boolean' | 'string' | 'number' | 'json';

/**
 * Maps a `FlagKind` discriminant to its runtime value type.
 *
 * @typeParam K  Kind discriminant.
 */
export type FlagValueOfKind<K extends FlagKind> =
  K extends 'boolean' ? boolean
  : K extends 'string' ? string
  : K extends 'number' ? number
  : K extends 'json' ? Json
  : never;
