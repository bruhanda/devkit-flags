import type { EvaluationContext } from './context.js';
import type { FlagSchema, FlagKeysOf, FlagValueOf, FlagValuesOf } from './flag-schema.js';
import type { EvaluationResult } from './result.js';
import type { AttributeSchema, RuleGroup } from './rules.js';
import type { FlagSource, FlagSourceSnapshot } from './source.js';
import type { Environment } from './env.js';
import type { OnEvaluation, RedactSubject } from './observability.js';

/**
 * Frozen, normalised configuration the handle was constructed with.
 */
export interface FlagsHandleConfig<TSchema extends FlagSchema = FlagSchema> {
  readonly flags: TSchema;
  readonly environment: Environment;
  readonly salt: string;
  readonly segments?: Readonly<Record<string, RuleGroup>>;
  readonly subjectId?: (ctx: EvaluationContext) => string;
  readonly onEvaluation?: OnEvaluation;
  readonly redactSubject?: RedactSubject;
  readonly sources: readonly FlagSource[];
}

/** Snapshot listener — fires after every reload propagates. */
export type FlagsListener = (snapshot: FlagSourceSnapshot) => void;

/**
 * The runtime handle returned by `defineFlags` / `createFlags`. Exposes
 * a dual sync/async surface — `get*` reads the current frozen snapshot
 * synchronously; `get*Async` awaits initial load on first call.
 */
export interface FlagsHandle<
  TSchema extends FlagSchema = FlagSchema,
  TAttrs extends AttributeSchema = AttributeSchema,
> {
  get<K extends FlagKeysOf<TSchema>>(
    key: K,
    context?: EvaluationContext<TAttrs, TSchema>,
  ): FlagValueOf<TSchema, K>;
  get<K extends FlagKeysOf<TSchema>>(
    key: K,
    context: EvaluationContext<TAttrs, TSchema> | undefined,
    defaultValue: FlagValueOf<TSchema, K>,
  ): FlagValueOf<TSchema, K>;

  getAsync<K extends FlagKeysOf<TSchema>>(
    key: K,
    context?: EvaluationContext<TAttrs, TSchema>,
  ): Promise<FlagValueOf<TSchema, K>>;
  getAsync<K extends FlagKeysOf<TSchema>>(
    key: K,
    context: EvaluationContext<TAttrs, TSchema> | undefined,
    defaultValue: FlagValueOf<TSchema, K>,
  ): Promise<FlagValueOf<TSchema, K>>;

  getAll(context?: EvaluationContext<TAttrs, TSchema>): FlagValuesOf<TSchema>;
  getAllAsync(context?: EvaluationContext<TAttrs, TSchema>): Promise<FlagValuesOf<TSchema>>;

  getDetail<K extends FlagKeysOf<TSchema>>(
    key: K,
    context?: EvaluationContext<TAttrs, TSchema>,
  ): EvaluationResult<FlagValueOf<TSchema, K>>;
  getDetailAsync<K extends FlagKeysOf<TSchema>>(
    key: K,
    context?: EvaluationContext<TAttrs, TSchema>,
  ): Promise<EvaluationResult<FlagValueOf<TSchema, K>>>;

  ready(): Promise<void>;

  subscribe(listener: FlagsListener): () => void;
  reload(): Promise<FlagSourceSnapshot>;
  dispose(): Promise<void>;

  readonly config: Readonly<FlagsHandleConfig<TSchema>>;
  snapshot(): FlagSourceSnapshot;
}
