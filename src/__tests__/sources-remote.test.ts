import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineFlags } from '../core/define.js';
import { FlagsError } from '../errors/base.js';
import { EtagCache } from '../sources/remote/etag.js';
import { fetchJson } from '../sources/remote/fetch-json.js';
import { backoffDelay, IntervalDriver } from '../sources/remote/poll.js';
import { createRemoteSource } from '../sources/remote/index.js';

describe('EtagCache', () => {
  it('should set ETag and Last-Modified after captureFrom', () => {
    const cache = new EtagCache();
    cache.captureFrom(
      new Response('', {
        headers: {
          ETag: 'W/"abc"',
          'Last-Modified': 'Wed, 01 Jan 2025 00:00:00 GMT',
        },
      }),
    );
    const headers = new Headers();
    cache.applyTo(headers);
    expect(headers.get('If-None-Match')).toBe('W/"abc"');
    expect(headers.get('If-Modified-Since')).toBe('Wed, 01 Jan 2025 00:00:00 GMT');
  });

  it('should not set headers when no ETag captured', () => {
    const cache = new EtagCache();
    const headers = new Headers();
    cache.applyTo(headers);
    expect(headers.has('If-None-Match')).toBe(false);
  });
});

describe('backoffDelay', () => {
  it('should grow exponentially up to cap', () => {
    expect(backoffDelay({ base: 100, cap: 1000 }, 0)).toBe(100);
    expect(backoffDelay({ base: 100, cap: 1000 }, 1)).toBe(200);
    expect(backoffDelay({ base: 100, cap: 1000 }, 5)).toBe(1000);
  });

  it('should clamp the exponent', () => {
    expect(backoffDelay({ base: 1, cap: 1_000_000 }, 100)).toBe(1_000_000);
  });
});

describe('IntervalDriver', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call tick() on every interval', async () => {
    vi.useFakeTimers();
    const tick = vi.fn().mockResolvedValue(undefined);
    const d = new IntervalDriver(50, tick, { base: 1, cap: 100 });
    d.start();
    await vi.advanceTimersByTimeAsync(160);
    expect(tick).toHaveBeenCalled();
    d.stop();
  });

  it('should be idempotent on repeated start', () => {
    vi.useFakeTimers();
    const tick = vi.fn().mockResolvedValue(undefined);
    const d = new IntervalDriver(50, tick, { base: 1, cap: 100 });
    d.start();
    d.start();
    d.stop();
  });
});

describe('fetchJson', () => {
  it('should return notModified=true on 304', async () => {
    const fakeResponse = {
      status: 304,
      ok: false,
      headers: new Headers(),
      text: async () => '',
      json: async () => ({}),
      body: null,
    } as unknown as Response;
    const fetchImpl = (() => Promise.resolve(fakeResponse)) as typeof fetch;
    const r = await fetchJson('https://x', {
      maxBytes: 1024,
      timeoutMs: 1000,
      fetchImpl,
    });
    expect(r.notModified).toBe(true);
  });

  it('should parse a JSON 200 response', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ a: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )) as typeof fetch;
    const r = await fetchJson<{ a: number }>('https://x', {
      maxBytes: 1024,
      timeoutMs: 1000,
      fetchImpl,
    });
    if (!r.notModified) {
      expect(r.body.a).toBe(1);
    }
  });

  it('should reject non-2xx with SOURCE_LOAD_FAILED', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('', { status: 500 }))) as typeof fetch;
    await expect(
      fetchJson('https://x', { maxBytes: 1024, timeoutMs: 1000, fetchImpl }),
    ).rejects.toThrow(FlagsError);
  });

  it('should reject on payload exceeding declared Content-Length', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response('hello', {
          status: 200,
          headers: { 'Content-Length': '99999' },
        }),
      )) as typeof fetch;
    try {
      await fetchJson('https://x', { maxBytes: 100, timeoutMs: 1000, fetchImpl });
      expect.fail();
    } catch (err) {
      if (FlagsError.is(err)) expect(err.code).toBe('PAYLOAD_TOO_LARGE');
    }
  });

  it('should reject on JSON parse failure', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response('{not json}', { status: 200 }),
      )) as typeof fetch;
    await expect(
      fetchJson('https://x', { maxBytes: 1024, timeoutMs: 1000, fetchImpl }),
    ).rejects.toThrow(FlagsError);
  });

  it('should reject when global fetch is unavailable', async () => {
    await expect(
      fetchJson('https://x', {
        maxBytes: 1024,
        timeoutMs: 1000,
        fetchImpl: undefined as never,
      } as never),
    ).rejects.toThrow();
  });
});

describe('createRemoteSource', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fail-open when initial fetch fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = (() =>
      Promise.reject(new Error('network down'))) as typeof fetch;
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: false } },
      sources: [
        createRemoteSource('https://invalid.example.test/flags.json', {
          fetch: fetchImpl,
          failOpen: true,
        }),
      ],
    });
    await flags.ready();
    const detail = flags.getDetail('x');
    expect(detail.stale).toBe(true);
  });

  it('should reject when failOpen=false and initial fetch fails', async () => {
    const fetchImpl = (() =>
      Promise.reject(new Error('boom'))) as typeof fetch;
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: false } },
      sources: [
        createRemoteSource('https://invalid.example.test/flags.json', {
          fetch: fetchImpl,
          failOpen: false,
        }),
      ],
    });
    await expect(flags.ready()).rejects.toThrow(FlagsError);
  });

  it('should overlay a successfully loaded payload', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            flags: { x: { kind: 'boolean', default: true } },
          }),
          { status: 200 },
        ),
      )) as typeof fetch;
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: false } },
      sources: [
        createRemoteSource('https://x', { fetch: fetchImpl }),
      ],
    });
    await flags.ready();
    expect(flags.get('x')).toBe(true);
    await flags.dispose();
  });

  it('should reject pollInterval on workers runtime', async () => {
    const { _resetRuntimeCacheForTests } = await import('../utils/runtime.js');
    const g = globalThis as { EdgeRuntime?: unknown };
    const original = g.EdgeRuntime;
    g.EdgeRuntime = 'edge';
    _resetRuntimeCacheForTests();
    try {
      expect(() =>
        createRemoteSource('https://x', { pollInterval: 5000 }),
      ).toThrow(FlagsError);
    } finally {
      g.EdgeRuntime = original;
      _resetRuntimeCacheForTests();
    }
  });

  it('should support reload', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ flags: { x: { kind: 'boolean', default: true } } }),
          { status: 200 },
        ),
      )) as typeof fetch;
    const source = createRemoteSource('https://x', { fetch: fetchImpl });
    await source.load();
    const next = await source.reload!();
    expect(next.origin).toBe('remote');
    await source.close!();
  });
});
