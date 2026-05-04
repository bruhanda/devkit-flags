import type { Json } from './json.js';
import type { FlagKind } from './flag-kind.js';
import type { AttributeSchema, Rollout, Rule } from './rules.js';

/**
 * Standard-Schema-V1-compatible validator surface. Detected duck-typed
 * via the `~standard` namespace so consumers can pass Zod, Valibot, or
 * Arktype validators with no peer dep on this library's side.
 */
export interface StandardSchemaV1<TOutput = unknown> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) =>
      | { readonly value: TOutput; readonly issues?: undefined }
      | { readonly issues: ReadonlyArray<{ readonly message: string }> }
      | Promise<
          | { readonly value: TOutput; readonly issues?: undefined }
          | { readonly issues: ReadonlyArray<{ readonly message: string }> }
        >;
  };
}

interface BaseFlagSpec<TKind extends FlagKind, TValue> {
  readonly kind: TKind;
  readonly description?: string;
  readonly environments?: Readonly<Record<string, TValue>>;
  readonly rules?: ReadonlyArray<Rule<TValue, AttributeSchema, string>>;
  readonly rollout?: Rollout<TValue, AttributeSchema>;
  readonly tags?: readonly string[];
  readonly deprecated?: boolean;
}

/** Boolean flag — `default` is `boolean`, no value-set restriction. */
export interface BooleanFlagSpec extends BaseFlagSpec<'boolean', boolean> {
  readonly default: boolean;
}

/**
 * String flag. When `values` is supplied as a literal-tuple via
 * `as const`, `default`, every rule value, and every multivariate
 * rollout key narrows to the union literal `TValues`.
 */
export interface StringFlagSpec<TValues extends string = string>
  extends BaseFlagSpec<'string', TValues> {
  readonly default: TValues;
  readonly values?: readonly TValues[];
}

/** Number flag. Optional `[min, max]` clamp at coercion time. */
export interface NumberFlagSpec extends BaseFlagSpec<'number', number> {
  readonly default: number;
  readonly range?: readonly [number, number];
}

/**
 * JSON flag. Optional Standard-Schema-V1 validator narrows the
 * resolved value to the validator's inferred output type.
 */
export interface JsonFlagSpec<TShape = Json> extends BaseFlagSpec<'json', TShape> {
  readonly default: TShape;
  readonly schema?: StandardSchemaV1<TShape>;
}

/**
 * Discriminated union of every supported flag kind. The discriminant
 * `kind` carries through to the type returned by `flags.get(key)`.
 */
export type FlagSpec =
  | BooleanFlagSpec
  | StringFlagSpec
  | NumberFlagSpec
  | JsonFlagSpec;
