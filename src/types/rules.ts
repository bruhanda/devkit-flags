import type { Json } from './json.js';

/**
 * Attribute-schema descriptor. Maps each named attribute to a primitive
 * kind. Used as the second generic on `defineFlags` to narrow targeting,
 * `Subject.attributes`, and `EvaluationContext.overrides`. Runtime cost:
 * zero — the descriptor is purely a TS hint.
 */
export interface AttributeSchema {
  readonly [key: string]: 'string' | 'number' | 'boolean' | 'json';
}

/** Maps an `AttributeSchema` descriptor to its runtime value shape. */
export type AttributesOf<TAttrs extends AttributeSchema> = {
  readonly [K in keyof TAttrs]?: TAttrs[K] extends 'string'
    ? string
    : TAttrs[K] extends 'number'
      ? number
      : TAttrs[K] extends 'boolean'
        ? boolean
        : Json;
};

/**
 * A single attribute matcher. Operators see the attribute by key.
 *
 * Core matchers (always available, ship in the 3 KB core):
 *   `eq`, `neq`, `in`, `nin`, `exists`.
 *
 * Extended matchers (opt-in via `@devkit/flags/matchers/extended`):
 *   `gt`, `gte`, `lt`, `lte`, `contains`, `startsWith`, `endsWith`,
 *   `regex`, `custom`.
 *
 * `custom` is in-code-only and CANNOT appear in JSON / remote sources;
 * `parseFlagsJson` rejects it with `UNSAFE_MATCHER_FROM_JSON`.
 */
export type Matcher =
  | { readonly eq: Json }
  | { readonly neq: Json }
  | { readonly in: readonly Json[] }
  | { readonly nin: readonly Json[] }
  | { readonly exists: boolean }
  | { readonly gt: number | string }
  | { readonly gte: number | string }
  | { readonly lt: number | string }
  | { readonly lte: number | string }
  | { readonly regex: string; readonly flags?: string }
  | { readonly contains: string }
  | { readonly startsWith: string }
  | { readonly endsWith: string }
  | { readonly custom: (value: Json | undefined) => boolean };

/** String-union of every supported matcher discriminant. */
export type Operator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'nin'
  | 'exists'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'regex'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'custom';

/**
 * Boolean composition of matchers. The default is implicit-AND when an
 * object map is given; explicit `$and` / `$or` / `$not` keys nest.
 * `{ $segment: 'name' }` references a named `RuleGroup` declared in
 * `config.segments`.
 */
export type RuleGroup<
  TAttrs extends AttributeSchema = AttributeSchema,
  TSegments extends string = string,
> =
  | { readonly $and: readonly RuleGroup<TAttrs, TSegments>[] }
  | { readonly $or: readonly RuleGroup<TAttrs, TSegments>[] }
  | { readonly $not: RuleGroup<TAttrs, TSegments> }
  | { readonly $segment: TSegments }
  | { readonly [K in keyof TAttrs]?: Matcher };

/** Type-level segment-name handle — flows from `config.segments`. */
export type SegmentName<TSegments extends string = string> = TSegments;

/**
 * Targeting rule — a guard plus an outcome. The outcome may be a fixed
 * `value`, a `rollout`, or both. When neither is supplied the rule is
 * an analytics-only no-op: it fires the observability hook and falls
 * through to the next rule.
 */
export interface Rule<
  TValue = unknown,
  TAttrs extends AttributeSchema = AttributeSchema,
  TSegments extends string = string,
> {
  readonly id?: string;
  readonly description?: string;
  readonly when?: RuleGroup<TAttrs, TSegments>;
  readonly value?: TValue;
  readonly rollout?: Rollout<TValue, TAttrs>;
}

/**
 * Percentage rollout. The simplest form is `{ percentage: N }` — bucket
 * `0..N` enables, the rest returns the spec's default. The multivariate
 * form `{ variants: { ... } }` weighs every named variant.
 *
 * Bucketing is deterministic via FNV-1a 32-bit:
 *   `bucket = FNV-1a(salt + ':' + flagKey + ':' + subjectId) % 10_000`.
 */
export type Rollout<
  TValues = unknown,
  TAttrs extends AttributeSchema = AttributeSchema,
> =
  | {
      readonly percentage: number;
      readonly subjectId?: (
        ctx: import('./context.js').EvaluationContext<TAttrs>,
      ) => string;
    }
  | {
      readonly variants: [TValues] extends [string]
        ? Readonly<Partial<Record<TValues, number>>>
        : Readonly<Record<string, number>>;
      readonly subjectId?: (
        ctx: import('./context.js').EvaluationContext<TAttrs>,
      ) => string;
    };
