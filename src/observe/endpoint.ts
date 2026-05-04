import type { EvaluationEvent, OnEvaluation } from '../types/observability.js';

interface EndpointTapOptions {
  readonly batchSize?: number;
  readonly flushIntervalMs?: number;
  readonly fetch?: typeof fetch;
  /** Forward `subject.attributes` along with `subject.id`. Default: `false`. */
  readonly forwardAttributes?: boolean;
}

/**
 * Generic POST-to-URL batching tap. Buffers events up to `batchSize`
 * (default 50) or `flushIntervalMs` (default 5_000), whichever fires
 * first, then POSTs them as a JSON array.
 *
 * `subject.attributes` is stripped by default. Pass
 * `forwardAttributes: true` to opt in — the consumer takes
 * responsibility for the GDPR posture of their own endpoint.
 *
 * Network failures are swallowed (logged via `console.warn`) — the
 * tap MUST never propagate errors to the calling `flags.get()`.
 *
 * @param url   The endpoint to POST events to.
 * @param opts  Optional batching configuration.
 * @returns     An `OnEvaluation` hook.
 *
 * @example
 *   const tap = toEndpoint('https://api.example.com/flag-events', {
 *     batchSize: 100,
 *   });
 *   defineFlags({ flags: { ... }, onEvaluation: tap });
 */
export function toEndpoint(url: string, opts?: EndpointTapOptions): OnEvaluation {
  const batchSize = opts?.batchSize ?? 50;
  const flushIntervalMs = opts?.flushIntervalMs ?? 5_000;
  const fetchImpl = opts?.fetch ?? globalThis.fetch;
  const forwardAttributes = opts?.forwardAttributes ?? false;
  const buffer: EvaluationEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    if (buffer.length === 0) return;
    if (typeof fetchImpl !== 'function') return;
    const payload = buffer.splice(0, buffer.length).map((e) => sanitize(e, forwardAttributes));
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    void fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[devkit/flags] toEndpoint flush failed:', err);
    });
  }

  return (event) => {
    buffer.push(event);
    if (buffer.length >= batchSize) {
      flush();
      return;
    }
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        flush();
      }, flushIntervalMs);
    }
  };
}

function sanitize(
  event: EvaluationEvent,
  forwardAttributes: boolean,
): EvaluationEvent {
  if (event.subject === undefined) return event;
  if (forwardAttributes) return event;
  return { ...event, subject: { id: event.subject.id } };
}
