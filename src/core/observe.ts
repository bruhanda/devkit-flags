import type { Subject } from '../types/context.js';
import type {
  EvaluationEvent,
  OnEvaluation,
  RedactSubject,
} from '../types/observability.js';
import type { AttributeSchema } from '../types/rules.js';

/**
 * Default redactor — strips `attributes` and forwards only `subject.id`.
 * Aligns the public observability surface with the PostHog `distinctId`
 * model and side-steps GDPR exposure unless the consumer explicitly
 * opts in.
 */
export const idOnlyRedactor: RedactSubject = (s) => ({ id: s.id });

/**
 * Run the user's `onEvaluation` hook. Wraps the call in a try/catch
 * so a thrown / rejected hook never propagates to the caller — the
 * error is surfaced via `console.error` with the documented
 * `OBSERVABILITY_HOOK_ERROR` code.
 *
 * @param hook   The user-supplied hook (or `undefined`).
 * @param event  The pre-built event payload.
 *
 * @example
 *   dispatchEvaluation(hook, { flagKey: 'x', ... });
 */
export function dispatchEvaluation(
  hook: OnEvaluation | undefined,
  event: EvaluationEvent,
): void {
  if (hook === undefined) return;
  try {
    const result = hook(event);
    if (
      result !== undefined &&
      typeof (result as { then?: unknown }).then === 'function'
    ) {
      (result as Promise<void>).catch((err: unknown) => {
        reportHookError(err);
      });
    }
  } catch (err) {
    reportHookError(err);
  }
}

/**
 * Apply the configured (or default) redactor to a `Subject`. Returns
 * `undefined` when the subject is absent so anonymous reads never
 * surface a `subject` field on the event.
 */
export function redactSubject(
  subject: Subject<AttributeSchema> | undefined,
  redactor: RedactSubject | undefined,
): Pick<Subject, 'id'> | Subject<AttributeSchema> | undefined {
  if (subject === undefined) return undefined;
  const fn = redactor ?? idOnlyRedactor;
  const projected = fn(subject);
  if (projected.id === undefined) return { id: subject.id };
  return projected as Subject<AttributeSchema>;
}

function reportHookError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`[devkit/flags] OBSERVABILITY_HOOK_ERROR: ${message}`);
}
