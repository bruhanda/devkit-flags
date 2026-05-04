import type {
  BooleanFlagSpec,
  FlagSpec,
  JsonFlagSpec,
  NumberFlagSpec,
  StringFlagSpec,
} from './flag-spec.js';

/** A schema is a record of named `FlagSpec`s. */
export type FlagSchema = Record<string, FlagSpec>;

/** All declared flag-key names as a `string` union. */
export type FlagKeysOf<TSchema extends FlagSchema> = keyof TSchema & string;

/**
 * Maps a `(schema, key)` pair to the flag's runtime value type.
 *
 * - `BooleanFlagSpec` → `boolean`
 * - `StringFlagSpec<V>` → `V` (literal union when `values` is supplied)
 * - `NumberFlagSpec` → `number`
 * - `JsonFlagSpec<J>` → `J` (validator output when `schema` is supplied)
 */
export type FlagValueOf<
  TSchema extends FlagSchema,
  TKey extends keyof TSchema,
> = TSchema[TKey] extends BooleanFlagSpec
  ? boolean
  : TSchema[TKey] extends StringFlagSpec<infer V>
    ? V
    : TSchema[TKey] extends NumberFlagSpec
      ? number
      : TSchema[TKey] extends JsonFlagSpec<infer J>
        ? J
        : never;

/** Aggregates every flag in the schema into a single record of values. */
export type FlagValuesOf<TSchema extends FlagSchema> = {
  readonly [K in FlagKeysOf<TSchema>]: FlagValueOf<TSchema, K>;
};
