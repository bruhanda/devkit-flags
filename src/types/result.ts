/**
 * Why a flag value was chosen. Stable across versions — additions are
 * non-breaking; renames are breaking.
 */
export type EvaluationReason =
  | 'STATIC'
  | 'ENVIRONMENT'
  | 'TARGETING_MATCH'
  | 'TARGETING_FALLBACK'
  | 'ROLLOUT_INCLUDED'
  | 'ROLLOUT_EXCLUDED'
  | 'OVERRIDE'
  | 'STALE'
  | 'ERROR';

/** The source layer that supplied the resolved spec. */
export type EvaluationSource =
  | 'defaults'
  | 'json'
  | 'env'
  | 'remote'
  | 'compose'
  | 'override';

/**
 * The outcome of a single `flags.get*()` call. `value` is typed to the
 * declared flag kind; the remaining fields are diagnostic and surface
 * through observability hooks and dev tooling.
 */
export interface EvaluationResult<TValue = unknown> {
  readonly value: TValue;
  readonly key: string;
  readonly reason: EvaluationReason;
  readonly ruleId?: string;
  readonly bucket?: number;
  readonly source: EvaluationSource;
  readonly stale: boolean;
}
