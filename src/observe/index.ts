import type { OnEvaluation } from '../types/observability.js';

export { toPostHog } from './posthog.js';
export type { PostHogLikeClient } from './posthog.js';
export { toEndpoint } from './endpoint.js';
export type {
  OnEvaluation,
  EvaluationEvent,
  RedactSubject,
} from '../types/observability.js';

/**
 * Log every evaluation to the console. Intended for local dev — never
 * ship to production (latency-sensitive paths should not pay the
 * stringification cost).
 *
 * @param level  Console method to call (`'log' | 'debug' | 'info'`).
 * @returns      An `OnEvaluation` hook.
 *
 * @example
 *   defineFlags({ flags: { ... }, onEvaluation: toConsole('debug') });
 */
export function toConsole(level: 'log' | 'debug' | 'info' = 'debug'): OnEvaluation {
  return (event) => {
    // eslint-disable-next-line no-console
    console[level](
      `[devkit/flags] ${event.flagKey}=${JSON.stringify(event.value)} reason=${event.reason}` +
        (event.ruleId !== undefined ? ` ruleId=${event.ruleId}` : '') +
        (event.bucket !== undefined ? ` bucket=${event.bucket}` : ''),
    );
  };
}
