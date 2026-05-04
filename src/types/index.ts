export type { Json, Jsonable } from './json.js';
export type { Environment } from './env.js';
export type { FlagKind, FlagValueOfKind } from './flag-kind.js';
export type {
  FlagSpec,
  BooleanFlagSpec,
  StringFlagSpec,
  NumberFlagSpec,
  JsonFlagSpec,
  StandardSchemaV1,
} from './flag-spec.js';
export type {
  FlagSchema,
  FlagKeysOf,
  FlagValueOf,
  FlagValuesOf,
} from './flag-schema.js';
export type { EvaluationContext, Subject } from './context.js';
export type {
  AttributeSchema,
  AttributesOf,
  Rule,
  RuleGroup,
  Rollout,
  Matcher,
  Operator,
  SegmentName,
} from './rules.js';
export type {
  EvaluationResult,
  EvaluationReason,
  EvaluationSource,
} from './result.js';
export type {
  FlagSource,
  FlagSourceSnapshot,
  FlagSourceSubscribeOptions,
} from './source.js';
export type {
  FlagsHandle,
  FlagsHandleConfig,
  FlagsListener,
} from './flags.js';
export type {
  OnEvaluation,
  EvaluationEvent,
  RedactSubject,
} from './observability.js';

import type { FlagSchema } from './flag-schema.js';
import type { AttributeSchema, RuleGroup } from './rules.js';
import type { Environment } from './env.js';
import type { EvaluationContext } from './context.js';
import type { FlagSource } from './source.js';
import type { OnEvaluation, RedactSubject } from './observability.js';

/**
 * Configuration accepted by `defineFlags<TSchema, TAttrs>()`. Same
 * runtime shape as `CreateFlagsConfig` but typed against the inferred
 * schema literal so flag-key autocomplete + value-type narrowing flow
 * through `get()`, `getAll()`, and every adapter binding.
 */
export interface DefineFlagsConfig<
  TSchema extends FlagSchema,
  TAttrs extends AttributeSchema = AttributeSchema,
> {
  readonly flags: TSchema;
  readonly attributes?: TAttrs;
  readonly segments?: Readonly<Record<string, RuleGroup<TAttrs>>>;
  readonly environment?: Environment;
  readonly sources?: readonly FlagSource[];
  readonly subjectId?: (ctx: EvaluationContext<TAttrs, TSchema>) => string;
  readonly salt?: string;
  readonly onEvaluation?: OnEvaluation;
  readonly redactSubject?: RedactSubject;
}

/**
 * Lower-level configuration for `createFlags()` — the dynamic-schema
 * factory. `flags.get()` returns `unknown` because the schema is not
 * a TS literal at the call site.
 */
export interface CreateFlagsConfig {
  readonly flags: FlagSchema;
  readonly segments?: Readonly<Record<string, RuleGroup>>;
  readonly environment?: Environment;
  readonly sources?: readonly FlagSource[];
  readonly subjectId?: (ctx: EvaluationContext) => string;
  readonly salt?: string;
  readonly onEvaluation?: OnEvaluation;
  readonly redactSubject?: RedactSubject;
}
