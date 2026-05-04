import { createFlags } from './flags.js';
import type {
  CreateFlagsConfig,
  DefineFlagsConfig,
  FlagsHandle,
} from '../types/index.js';
import type { FlagSchema } from '../types/flag-schema.js';
import type { AttributeSchema } from '../types/rules.js';

/**
 * Declare a typed schema of feature flags. Returns a `FlagsHandle`
 * that is `Object.freeze`-d and safe to share across requests, edge
 * isolates and React renders.
 *
 * The schema is the single source of truth for compile-time names
 * and value types. Every subsequent `flags.get('newCheckout', ctx)`
 * narrows the return type to the declared `FlagKind` (boolean /
 * string / number / Json) and rejects unknown keys at the call site.
 *
 * The same handle works on Node, Bun, Deno, Cloudflare Workers,
 * Vercel Edge and the browser. Source loading is lazy: the implicit
 * `defaultsSource` runs synchronously at construction; every other
 * source is awaited the first time `flags.getAsync()` (or `ready()`)
 * is called.
 *
 * @typeParam TSchema  Inferred from `config.flags`. Do not pass
 *                     manually — TS infers literal types so `get()`
 *                     can narrow returns.
 * @typeParam TAttrs   Inferred from `config.attributes`. When supplied,
 *                     every `Subject.attributes`, `RuleGroup` key, and
 *                     `EvaluationContext.overrides` typo becomes a
 *                     compile-time error.
 *
 * @param config  Schema, sources, environment, observability hooks.
 * @returns       A frozen `FlagsHandle<TSchema, TAttrs>`.
 * @throws        `FlagsError('INVALID_SCHEMA')` on malformed schema.
 *
 * @example  Minimal — boolean kill switch
 *   import { defineFlags } from '@devkit/flags';
 *
 *   export const flags = defineFlags({
 *     flags: {
 *       newCheckout: { kind: 'boolean', default: false },
 *       maintenance: { kind: 'boolean', default: false },
 *     },
 *   });
 *
 *   if (flags.get('newCheckout')) doNewCheckout();
 *
 * @example  Percentage rollout with consistent hashing
 *   const flags = defineFlags({
 *     flags: {
 *       newCheckout: {
 *         kind: 'boolean',
 *         default: false,
 *         rollout: { percentage: 25 },
 *       },
 *     },
 *   });
 *   flags.get('newCheckout', { subject: { id: 'user_42' } });
 *
 * @example  Targeting rules — pro-tier users only
 *   const flags = defineFlags({
 *     flags: {
 *       advancedAnalytics: {
 *         kind: 'boolean',
 *         default: false,
 *         rules: [{ when: { plan: { eq: 'pro' } }, value: true }],
 *       },
 *     },
 *     attributes: { plan: 'string' },
 *   });
 */
export function defineFlags<
  TSchema extends FlagSchema,
  TAttrs extends AttributeSchema = AttributeSchema,
>(config: DefineFlagsConfig<TSchema, TAttrs>): FlagsHandle<TSchema, TAttrs> {
  const runtimeConfig: CreateFlagsConfig = {
    flags: config.flags,
    ...(config.segments !== undefined
      ? { segments: config.segments as Readonly<Record<string, never>> }
      : {}),
    ...(config.environment !== undefined ? { environment: config.environment } : {}),
    ...(config.sources !== undefined ? { sources: config.sources } : {}),
    ...(config.subjectId !== undefined
      ? { subjectId: config.subjectId as never }
      : {}),
    ...(config.salt !== undefined ? { salt: config.salt } : {}),
    ...(config.onEvaluation !== undefined ? { onEvaluation: config.onEvaluation } : {}),
    ...(config.redactSubject !== undefined
      ? { redactSubject: config.redactSubject }
      : {}),
  };
  return createFlags(runtimeConfig) as unknown as FlagsHandle<TSchema, TAttrs>;
}
