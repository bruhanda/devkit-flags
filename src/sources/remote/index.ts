import { FlagsError } from '../../errors/base.js';
import { deepFreeze } from '../../utils/freeze.js';
import { detectRuntime } from '../../utils/runtime.js';
import type { FlagSource, FlagSourceSnapshot } from '../../types/source.js';
import { parseFlagsJson } from '../json/parse.js';
import { EtagCache } from './etag.js';
import { fetchJson } from './fetch-json.js';
import { IntervalDriver, type BackoffStrategy } from './poll.js';
import { startSseDriver } from './sse.js';

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_BACKOFF: BackoffStrategy = { base: 1_000, cap: 30_000 };

interface RemoteSourceOptions {
  /**
   * Polling cadence; ignored when `transport === 'sse'`.
   * Default: `60_000`. Rejected on Cloudflare Workers — supply a Cron
   * Trigger / Durable Object that calls `flags.reload()` instead.
   */
  readonly pollInterval?: number;
  /**
   * `'poll'` (default) or `'sse'`. SSE rejected on React Native because
   * RN's polyfilled `fetch` does not expose `Response.body.getReader()`.
   */
  readonly transport?: 'poll' | 'sse';
  /** Custom `fetch` (e.g. wrapped with auth). Default: `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  /** Default request init applied to every poll. Use for auth headers. */
  readonly init?: RequestInit;
  /** Maximum payload size in bytes. Default: 64 KiB. */
  readonly maxBytes?: number;
  /** Per-fetch timeout. Default: 5 s. */
  readonly requestTimeoutMs?: number;
  /** Back-off curve for transient errors. */
  readonly backoff?: BackoffStrategy;
  /**
   * Whether the initial fetch failure resolves successfully against
   * the static defaults (`true`, default) or rejects `flags.ready()`.
   */
  readonly failOpen?: boolean;
}

/**
 * Periodically fetch a JSON snapshot from a URL. Designed for use
 * against a static JSON file behind a CDN, your own admin service,
 * or a feature-flag platform's export.
 *
 * Uses `If-None-Match` + 304 handling so polling against a CDN is
 * essentially free. With `transport: 'sse'`, subscribes to a
 * Server-Sent Events stream instead of polling.
 *
 * @param url   Target URL.
 * @param opts  Optional polling / SSE configuration.
 * @returns     A `FlagSource` whose snapshot reflects the latest fetch.
 *
 * @throws  `FlagsError('INVALID_RUNTIME_OPTION')` when:
 *          - `pollInterval` is set on Cloudflare Workers (use a
 *            Cron Trigger / Durable Object alarm instead);
 *          - `transport: 'sse'` is requested on React Native.
 *
 * @example  Polling — 30 s cadence
 *   defineFlags({
 *     flags: { newCheckout: { kind: 'boolean', default: false } },
 *     sources: [createRemoteSource('https://cdn/flags.json', { pollInterval: 30_000 })],
 *   });
 */
export function createRemoteSource(
  url: string | URL,
  opts?: RemoteSourceOptions,
): FlagSource {
  const runtime = detectRuntime();
  const transport = opts?.transport ?? 'poll';

  if (transport === 'sse' && runtime === 'react-native') {
    throw new FlagsError(
      'INVALID_RUNTIME_OPTION',
      'createRemoteSource: SSE transport is not supported on React Native; use { transport: "poll" }',
      { context: { runtime } },
    );
  }

  if (
    runtime === 'workers' &&
    transport === 'poll' &&
    opts?.pollInterval !== undefined
  ) {
    throw new FlagsError(
      'INVALID_RUNTIME_OPTION',
      'createRemoteSource: pollInterval is unsupported on Cloudflare Workers; drive flags.reload() from a Cron Trigger / Durable Object alarm',
      { context: { runtime } },
    );
  }

  const requestTimeoutMs = opts?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const failOpen = opts?.failOpen ?? true;
  const backoff = opts?.backoff ?? DEFAULT_BACKOFF;
  const fetchImpl = opts?.fetch;
  const baseInit = opts?.init;
  const etag = new EtagCache();

  const listeners = new Set<(s: FlagSourceSnapshot) => void>();
  let snapshot: FlagSourceSnapshot | undefined;
  let driver: IntervalDriver | undefined;
  let sseDriver: { stop: () => Promise<void> } | undefined;

  async function fetchOnce(): Promise<FlagSourceSnapshot | undefined> {
    const headers = new Headers(baseInit?.headers);
    etag.applyTo(headers);
    const init: RequestInit = {
      ...baseInit,
      headers,
      method: baseInit?.method ?? 'GET',
    };
    const result = await fetchJson<unknown>(url, {
      init,
      ...(fetchImpl !== undefined ? { fetchImpl } : {}),
      maxBytes,
      timeoutMs: requestTimeoutMs,
    });
    if (result.notModified) {
      // Refresh `fetchedAt` so observers know polling is alive.
      if (snapshot !== undefined) {
        snapshot = deepFreeze({ ...snapshot, fetchedAt: Date.now(), stale: false });
      }
      return snapshot;
    }
    etag.captureFrom(result.response);
    const parsed = parseFlagsJson(result.body);
    snapshot = deepFreeze({
      flags: parsed.flags,
      segments: parsed.segments,
      origin: 'remote' as const,
      fetchedAt: Date.now(),
      stale: false,
    });
    return snapshot;
  }

  async function load(): Promise<FlagSourceSnapshot> {
    try {
      const result = await fetchOnce();
      ensurePollingStarted();
      ensureSseStarted();
      return (
        result ??
        deepFreeze({
          flags: {},
          origin: 'remote' as const,
          stale: true,
          fetchedAt: Date.now(),
        })
      );
    } catch (err) {
      if (!failOpen) throw err;
      ensurePollingStarted();
      ensureSseStarted();
      // eslint-disable-next-line no-console
      console.warn('[devkit/flags] remote source initial load failed; falling back:', err);
      snapshot = deepFreeze({
        flags: {},
        origin: 'remote' as const,
        stale: true,
        fetchedAt: Date.now(),
      });
      return snapshot;
    }
  }

  function ensurePollingStarted(): void {
    if (transport !== 'poll') return;
    if (runtime === 'workers') return;
    if (driver !== undefined) return;
    const intervalMs = opts?.pollInterval ?? DEFAULT_POLL_INTERVAL_MS;
    driver = new IntervalDriver(
      intervalMs,
      async () => {
        const next = await fetchOnce();
        if (next !== undefined) {
          for (const l of listeners) l(next);
        }
      },
      backoff,
    );
    driver.start();
  }

  function ensureSseStarted(): void {
    if (transport !== 'sse') return;
    if (sseDriver !== undefined) return;
    sseDriver = startSseDriver({
      url,
      backoff,
      ...(baseInit !== undefined ? { init: baseInit } : {}),
      ...(fetchImpl !== undefined ? { fetchImpl } : {}),
      onEvent: (data) => {
        try {
          const parsed = parseFlagsJson(data);
          snapshot = deepFreeze({
            flags: parsed.flags,
            segments: parsed.segments,
            origin: 'remote' as const,
            fetchedAt: Date.now(),
            stale: false,
          });
          for (const l of listeners) l(snapshot);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[devkit/flags] remote SSE payload rejected:', err);
        }
      },
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.warn('[devkit/flags] remote SSE error:', err);
      },
    });
  }

  return {
    id: 'remote',
    load,
    snapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async reload() {
      const next = await fetchOnce();
      const result =
        next ??
        deepFreeze({
          flags: {},
          origin: 'remote' as const,
          stale: true,
          fetchedAt: Date.now(),
        });
      if (next !== undefined) {
        for (const l of listeners) l(next);
      }
      return result;
    },
    async close() {
      driver?.stop();
      driver = undefined;
      if (sseDriver !== undefined) {
        await sseDriver.stop();
        sseDriver = undefined;
      }
      listeners.clear();
    },
  };
}

export type { BackoffStrategy } from './poll.js';
