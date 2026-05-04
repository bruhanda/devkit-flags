import type { Subject } from './context.js';
import type { EvaluationReason } from './result.js';
import type { AttributeSchema } from './rules.js';

/**
 * Observability hook signature. Fires once per `flags.get*()` call
 * (after coercion, before return). Errors thrown inside the hook are
 * caught and `console.error`-logged with `code: 'OBSERVABILITY_HOOK_ERROR'`;
 * they NEVER propagate to the caller.
 */
export type OnEvaluation = (event: EvaluationEvent) => void | Promise<void>;

/**
 * Payload forwarded to every `OnEvaluation` hook AND to the built-in
 * `toPostHog` / `toEndpoint` taps.
 *
 * `subject` is PII-safe by default — only `subject.id` is forwarded.
 * Attributes are stripped unless `defineFlags({ redactSubject: (s) => s })`
 * opts back in.
 */
export interface EvaluationEvent {
  readonly flagKey: string;
  readonly value: unknown;
  readonly reason: EvaluationReason;
  readonly ruleId?: string;
  readonly bucket?: number;
  readonly subject?: Pick<Subject, 'id'> | Subject<AttributeSchema>;
  readonly environment: string;
  readonly elapsedMs: number;
  readonly timestamp: number;
  readonly error?: { readonly code: string; readonly message: string };
}

/**
 * Subject redactor. Receives the full `Subject` and returns the
 * projection forwarded to hooks + taps.
 *
 *   default: `(s) => ({ id: s.id })`
 *   opt-in:  `(s) => s`
 */
export type RedactSubject = (subject: Subject<AttributeSchema>) => Partial<Subject<AttributeSchema>>;
