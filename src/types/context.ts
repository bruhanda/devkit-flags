import type { Environment } from './env.js';
import type { FlagSchema, FlagValuesOf } from './flag-schema.js';
import type { AttributeSchema, AttributesOf } from './rules.js';

/**
 * Per-evaluation payload that drives targeting + bucketing. Construct
 * a fresh one per call — the handle is stateless w.r.t. context.
 */
export interface EvaluationContext<
  TAttrs extends AttributeSchema = AttributeSchema,
  TSchema extends FlagSchema = FlagSchema,
> {
  readonly subject?: Subject<TAttrs>;
  readonly environment?: Environment;
  readonly overrides?: Partial<FlagValuesOf<TSchema>>;
}

/**
 * The subject (user / account / tenant) the evaluation is for.
 * `id` is required and drives consistent-hash bucketing; `attributes`
 * are consulted by targeting rules.
 */
export interface Subject<TAttrs extends AttributeSchema = AttributeSchema> {
  readonly id: string;
  readonly attributes?: AttributesOf<TAttrs>;
}
