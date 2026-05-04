import type {
  EvaluationContext,
  FlagKeysOf,
  FlagSchema,
  FlagsHandle,
} from '../../types/index.js';
import { translateReason } from './translate.js';

/**
 * Subset of the OpenFeature evaluation context we consult — keeps us
 * peer-dep-free at the TYPE layer too. Real OpenFeature contexts carry
 * many more fields; we only surface the ones we actually use.
 */
interface OpenFeatureEvaluationContext {
  readonly targetingKey?: string;
  readonly [key: string]:
    | boolean
    | number
    | string
    | undefined
    | Record<string, unknown>;
}

interface ResolutionDetails<T> {
  readonly value: T;
  readonly reason: string;
  readonly variant?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/**
 * OpenFeature `Provider` shape we expose. Matches the v1.x
 * `ServerProvider` interface — kept structural so consumers don't
 * need to install `@openfeature/server-sdk` to satisfy the type at
 * compile time (the peer dep is `optional: true` for runtime).
 */
export interface OpenFeatureProvider {
  readonly metadata: { readonly name: string };
  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context?: OpenFeatureEvaluationContext,
  ): ResolutionDetails<boolean>;
  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context?: OpenFeatureEvaluationContext,
  ): ResolutionDetails<string>;
  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context?: OpenFeatureEvaluationContext,
  ): ResolutionDetails<number>;
  resolveObjectEvaluation<T>(
    flagKey: string,
    defaultValue: T,
    context?: OpenFeatureEvaluationContext,
  ): ResolutionDetails<T>;
}

/**
 * Build an OpenFeature `Provider` backed by the supplied `FlagsHandle`.
 * Reasons translate to OpenFeature's `ResolutionReason` string-union via
 * `translateReason`.
 *
 * @param flags  The configured `FlagsHandle`.
 * @returns      A structural `OpenFeatureProvider` ready to register
 *               with `OpenFeature.setProvider(...)`.
 *
 * @example
 *   import { OpenFeature } from '@openfeature/server-sdk';
 *   import { createOpenFeatureProvider } from '@devkit/flags/adapters/openfeature';
 *
 *   OpenFeature.setProvider(createOpenFeatureProvider(flags));
 *   const client = OpenFeature.getClient();
 *   const enabled = client.getBooleanValue('newCheckout', false);
 */
export function createOpenFeatureProvider<S extends FlagSchema>(
  flags: FlagsHandle<S>,
): OpenFeatureProvider {
  function build<T>(
    flagKey: string,
    defaultValue: T,
    ofContext: OpenFeatureEvaluationContext | undefined,
  ): ResolutionDetails<T> {
    const evalContext = mapContext(ofContext);
    try {
      const detail = flags.getDetail(flagKey as FlagKeysOf<S>, evalContext as never);
      const reason = translateReason(detail.reason);
      const result: ResolutionDetails<T> = {
        value: detail.value as T,
        reason,
        ...(detail.ruleId !== undefined ? { variant: detail.ruleId } : {}),
        ...(detail.reason === 'ERROR'
          ? { errorCode: 'GENERAL', errorMessage: 'evaluation aborted' }
          : {}),
      };
      return result;
    } catch (err) {
      return {
        value: defaultValue,
        reason: 'ERROR',
        errorCode: 'GENERAL',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    metadata: { name: '@devkit/flags' },
    resolveBooleanEvaluation: (key, def, ctx) => build<boolean>(key, def, ctx),
    resolveStringEvaluation: (key, def, ctx) => build<string>(key, def, ctx),
    resolveNumberEvaluation: (key, def, ctx) => build<number>(key, def, ctx),
    resolveObjectEvaluation: <T,>(
      key: string,
      def: T,
      ctx?: OpenFeatureEvaluationContext,
    ) => build<T>(key, def, ctx),
  };
}

function mapContext(
  ofContext: OpenFeatureEvaluationContext | undefined,
): EvaluationContext {
  if (ofContext === undefined) return {};
  const { targetingKey, ...rest } = ofContext;
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) attributes[key] = value;
  }
  if (targetingKey !== undefined) {
    return {
      subject: { id: targetingKey, attributes: attributes as never },
    };
  }
  if (Object.keys(attributes).length > 0) {
    return { subject: { id: '', attributes: attributes as never } };
  }
  return {};
}

export { translateReason } from './translate.js';
