import type { EvaluationContext } from '../types/context.js';
import type { FlagSpec, NumberFlagSpec } from '../types/flag-spec.js';
import type {
  EvaluationReason,
  EvaluationResult,
  EvaluationSource,
} from '../types/result.js';
import type { Rollout, Rule, RuleGroup } from '../types/rules.js';
import { bucketFor, variantBucketFor } from './bucket.js';
import { clampNumber, coerce } from './coerce.js';
import { matchRule } from './rules.js';

interface EvaluateOptions {
  readonly key: string;
  readonly spec: FlagSpec;
  readonly context: EvaluationContext;
  readonly environment: string;
  readonly salt: string;
  readonly source: EvaluationSource;
  readonly stale: boolean;
  readonly segments: Readonly<Record<string, RuleGroup>>;
  readonly defaultSubjectId?: (ctx: EvaluationContext) => string;
  /** Per-flag overrides applied via `ctx.overrides`. */
  readonly callOverride?: unknown;
  /** Hook fired for every analytics-only rule that matched. */
  readonly recordExposure?: (key: string, ruleId: string | undefined) => void;
}

/**
 * Single evaluation pipeline. Pure — no side effects beyond the
 * optional `recordExposure` callback (used for analytics-only rules).
 * Never throws; every error path falls back to the static default
 * with `reason: 'ERROR'`.
 *
 * @param opts  Evaluation inputs (spec, context, environment, ...)
 * @returns     The full `EvaluationResult` for the flag.
 */
export function evaluateFlag(opts: EvaluateOptions): EvaluationResult {
  const { spec, context, environment, key, salt, source, stale, segments } = opts;

  // 0. Per-call override
  if (opts.callOverride !== undefined) {
    return finalize(opts.callOverride, 'OVERRIDE', spec, key, source, stale);
  }

  const envValue =
    spec.environments !== undefined ? spec.environments[environment] : undefined;

  // 1. Targeting rules (rules existing OR matched override).
  if (spec.rules !== undefined && spec.rules.length > 0) {
    for (const rule of spec.rules) {
      if (rule.when !== undefined && !matchRule(rule.when, context, segments)) {
        continue;
      }

      // Analytics-only rule — fire exposure, then fall through.
      if (rule.value === undefined && rule.rollout === undefined) {
        opts.recordExposure?.(key, rule.id);
        continue;
      }

      const subjectId = resolveSubjectId(
        rule.rollout as unknown as Rollout<unknown> | undefined,
        context,
        opts.defaultSubjectId,
      );

      if (rule.rollout !== undefined) {
        const decision = applyRollout(
          rule.rollout as unknown as Rollout<unknown>,
          salt,
          ruleBucketKey(key, rule.id),
          subjectId,
          rule.value,
        );
        if (decision !== undefined) {
          if (decision.reason === 'ROLLOUT_INCLUDED') {
            return finalize(
              decision.value,
              'ROLLOUT_INCLUDED',
              spec,
              key,
              source,
              stale,
              rule.id,
              decision.bucket,
            );
          }
          // Excluded — fall through to next rule.
          continue;
        }
      }

      if (rule.value !== undefined) {
        return finalize(rule.value, 'TARGETING_MATCH', spec, key, source, stale, rule.id);
      }
    }

    // Rules existed but none returned a value.
    if (envValue !== undefined) {
      return finalize(envValue, 'ENVIRONMENT', spec, key, source, stale);
    }
    if (spec.rollout !== undefined) {
      const subjectId = resolveSubjectId(
        spec.rollout as unknown as Rollout<unknown> | undefined,
        context,
        opts.defaultSubjectId,
      );
      const decision = applyRollout(
        spec.rollout as unknown as Rollout<unknown>,
        salt,
        key,
        subjectId,
        undefined,
      );
      if (decision !== undefined && decision.reason === 'ROLLOUT_INCLUDED') {
        return finalize(
          decision.value,
          'ROLLOUT_INCLUDED',
          spec,
          key,
          source,
          stale,
          undefined,
          decision.bucket,
        );
      }
    }
    return finalize(spec.default, 'TARGETING_FALLBACK', spec, key, source, stale);
  }

  // 2. Flag-level rollout (no targeting rules).
  if (spec.rollout !== undefined) {
    const subjectId = resolveSubjectId(
      spec.rollout as unknown as Rollout<unknown> | undefined,
      context,
      opts.defaultSubjectId,
    );
    const decision = applyRollout(
      spec.rollout as unknown as Rollout<unknown>,
      salt,
      key,
      subjectId,
      undefined,
    );
    if (decision !== undefined) {
      const reason: EvaluationReason =
        decision.reason === 'ROLLOUT_INCLUDED' ? 'ROLLOUT_INCLUDED' : 'ROLLOUT_EXCLUDED';
      const value = decision.reason === 'ROLLOUT_INCLUDED' ? decision.value : spec.default;
      return finalize(value, reason, spec, key, source, stale, undefined, decision.bucket);
    }
  }

  // 3. Environment override.
  if (envValue !== undefined) {
    return finalize(envValue, 'ENVIRONMENT', spec, key, source, stale);
  }

  // 4. Static default.
  return finalize(spec.default, 'STATIC', spec, key, source, stale);
}

interface RolloutDecision {
  reason: 'ROLLOUT_INCLUDED' | 'ROLLOUT_EXCLUDED';
  value: unknown;
  bucket: number | undefined;
}

function applyRollout(
  rollout: Rollout<unknown>,
  salt: string,
  bucketKey: string,
  subjectId: string,
  ruleValue: unknown,
): RolloutDecision | undefined {
  if ('percentage' in rollout) {
    const decision = bucketFor(salt, bucketKey, subjectId, rollout.percentage);
    if (decision.included) {
      return {
        reason: 'ROLLOUT_INCLUDED',
        value: ruleValue !== undefined ? ruleValue : true,
        bucket: decision.bucket,
      };
    }
    return { reason: 'ROLLOUT_EXCLUDED', value: undefined, bucket: decision.bucket };
  }
  if ('variants' in rollout) {
    const variants = rollout.variants as Record<string, number>;
    const { variant, bucket } = variantBucketFor(salt, bucketKey, subjectId, variants);
    return { reason: 'ROLLOUT_INCLUDED', value: variant, bucket };
  }
  return undefined;
}

function resolveSubjectId(
  rollout: Rollout<unknown> | undefined,
  context: EvaluationContext,
  fallback?: (ctx: EvaluationContext) => string,
): string {
  const extractor =
    rollout !== undefined && rollout.subjectId !== undefined ? rollout.subjectId : fallback;
  if (extractor !== undefined) {
    try {
      return extractor(context);
    } catch {
      // Extractor threw — fall back to the empty-subject id.
    }
  }
  return context.subject?.id ?? '';
}

function ruleBucketKey(flagKey: string, ruleId: string | undefined): string {
  return ruleId !== undefined ? `${flagKey}:${ruleId}` : flagKey;
}

function finalize(
  raw: unknown,
  reason: EvaluationReason,
  spec: FlagSpec,
  key: string,
  source: EvaluationSource,
  stale: boolean,
  ruleId?: string,
  bucket?: number,
): EvaluationResult {
  let value: unknown;
  try {
    value = coerce(raw, spec.kind);
    if (spec.kind === 'number') {
      const numberSpec = spec as NumberFlagSpec;
      if (numberSpec.range !== undefined) {
        value = clampNumber(value as number, numberSpec.range);
      }
    }
    if (spec.kind === 'string') {
      const stringSpec = spec as { values?: readonly string[] };
      if (
        stringSpec.values !== undefined &&
        !stringSpec.values.includes(value as string)
      ) {
        value = spec.default;
        return {
          key,
          value,
          reason: 'ERROR',
          source,
          stale,
          ...(ruleId !== undefined ? { ruleId } : {}),
          ...(bucket !== undefined ? { bucket } : {}),
        };
      }
    }
  } catch {
    return {
      key,
      value: spec.default,
      reason: 'ERROR',
      source,
      stale,
      ...(ruleId !== undefined ? { ruleId } : {}),
      ...(bucket !== undefined ? { bucket } : {}),
    };
  }
  return {
    key,
    value,
    reason,
    source,
    stale,
    ...(ruleId !== undefined ? { ruleId } : {}),
    ...(bucket !== undefined ? { bucket } : {}),
  };
}
