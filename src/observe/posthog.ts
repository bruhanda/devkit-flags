import type { EvaluationEvent, OnEvaluation } from '../types/observability.js';

/** Duck-typed PostHog client surface. The full SDK is not a dep. */
export interface PostHogLikeClient {
  capture(event: {
    event: string;
    properties: Record<string, unknown>;
    distinctId?: string;
  }): void;
}

/**
 * Forward every flag evaluation to PostHog. The evaluation event is
 * captured under the `feature_flag_evaluated` event name; PostHog's
 * `distinctId` is taken from `subject.id` when present.
 *
 * Intentionally strips `subject.attributes` before fan-out — PostHog
 * already stores user properties out of band; flag-evaluation events
 * should not duplicate them. Set `forwardAttributes: true` to override.
 *
 * @param client  Any object exposing `capture({ event, properties, distinctId })`.
 * @returns       An `OnEvaluation` hook ready to plug into `defineFlags`.
 *
 * @example
 *   import { PostHog } from 'posthog-node';
 *   import { defineFlags } from '@devkit/flags';
 *   import { toPostHog } from '@devkit/flags/observe';
 *
 *   const ph = new PostHog('phc_...');
 *   const flags = defineFlags({ flags: { ... }, onEvaluation: toPostHog(ph) });
 */
export function toPostHog(client: PostHogLikeClient): OnEvaluation {
  return (event: EvaluationEvent) => {
    const distinctId = event.subject?.id;
    const properties: Record<string, unknown> = {
      flag_key: event.flagKey,
      flag_value: event.value,
      reason: event.reason,
      environment: event.environment,
      timestamp: event.timestamp,
    };
    if (event.ruleId !== undefined) properties['rule_id'] = event.ruleId;
    if (event.bucket !== undefined) properties['bucket'] = event.bucket;
    if (event.error !== undefined) properties['error_code'] = event.error.code;
    client.capture({
      event: 'feature_flag_evaluated',
      properties,
      ...(distinctId !== undefined ? { distinctId } : {}),
    });
  };
}
