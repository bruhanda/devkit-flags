import { afterEach, describe, expect, it, vi } from 'vitest';
import { toConsole } from '../observe/index.js';
import { toEndpoint } from '../observe/endpoint.js';
import { toPostHog } from '../observe/posthog.js';
import type { EvaluationEvent } from '../types/observability.js';

const ev = (over: Partial<EvaluationEvent> = {}): EvaluationEvent => ({
  flagKey: 'x',
  value: true,
  reason: 'STATIC',
  environment: 'production',
  elapsedMs: 0,
  timestamp: 0,
  ...over,
});

describe('toConsole', () => {
  it('should call console[level] with a formatted string', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const hook = toConsole('debug');
    hook(ev({ ruleId: 'pro', bucket: 5 }));
    expect(spy).toHaveBeenCalled();
    const msg = spy.mock.calls[0]?.[0];
    expect(msg).toContain('x=');
    expect(msg).toContain('ruleId=pro');
    expect(msg).toContain('bucket=5');
    spy.mockRestore();
  });
});

describe('toPostHog', () => {
  it('should forward to client.capture', () => {
    const capture = vi.fn();
    const hook = toPostHog({ capture });
    hook(
      ev({
        ruleId: 'pro',
        bucket: 5,
        subject: { id: 'u1' },
        error: { code: 'X', message: 'm' },
      }),
    );
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'feature_flag_evaluated',
        distinctId: 'u1',
        properties: expect.objectContaining({
          flag_key: 'x',
          flag_value: true,
          reason: 'STATIC',
          rule_id: 'pro',
          bucket: 5,
          error_code: 'X',
        }),
      }),
    );
  });

  it('should omit distinctId when subject is absent', () => {
    const capture = vi.fn();
    const hook = toPostHog({ capture });
    hook(ev());
    const arg = capture.mock.calls[0]?.[0];
    expect(arg.distinctId).toBeUndefined();
  });
});

describe('toEndpoint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should batch events and POST when batchSize reached', async () => {
    const fetchSpy = vi.fn(async () => new Response(''));
    const tap = toEndpoint('https://example.test/events', {
      batchSize: 2,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    tap(ev({ flagKey: 'a' }));
    expect(fetchSpy).not.toHaveBeenCalled();
    tap(ev({ flagKey: 'b' }));
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('should flush after the timeout', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(async () => new Response(''));
    const tap = toEndpoint('https://example.test/events', {
      batchSize: 100,
      flushIntervalMs: 30,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    tap(ev());
    await vi.advanceTimersByTimeAsync(50);
    expect(fetchSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('should strip subject.attributes by default', async () => {
    const fetchSpy = vi.fn(async () => new Response(''));
    const tap = toEndpoint('https://example.test/events', {
      batchSize: 1,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    tap(
      ev({
        subject: { id: 'u1', attributes: { plan: 'pro' as never } },
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    const body = fetchSpy.mock.calls[0]?.[1]?.body as string;
    const parsed = JSON.parse(body);
    expect(parsed[0].subject).toEqual({ id: 'u1' });
  });

  it('should keep attributes when forwardAttributes=true', async () => {
    const fetchSpy = vi.fn(async () => new Response(''));
    const tap = toEndpoint('https://example.test/events', {
      batchSize: 1,
      forwardAttributes: true,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    tap(
      ev({
        subject: { id: 'u1', attributes: { plan: 'pro' as never } },
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    const body = fetchSpy.mock.calls[0]?.[1]?.body as string;
    const parsed = JSON.parse(body);
    expect(parsed[0].subject).toEqual({ id: 'u1', attributes: { plan: 'pro' } });
  });

  it('should swallow fetch failures', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => Promise.reject(new Error('net')));
    const tap = toEndpoint('https://example.test/events', {
      batchSize: 1,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    tap(ev());
    await new Promise((r) => setTimeout(r, 10));
    expect(warnSpy).toHaveBeenCalled();
  });
});
