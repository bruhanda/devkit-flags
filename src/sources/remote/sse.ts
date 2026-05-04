import { backoffDelay, type BackoffStrategy } from './poll.js';

interface SseDriverOptions {
  readonly url: string | URL;
  readonly init?: RequestInit;
  readonly fetchImpl?: typeof fetch;
  readonly onEvent: (data: string) => void;
  readonly onError?: (err: unknown) => void;
  readonly backoff: BackoffStrategy;
}

interface GlobalEventSourceCtor {
  new (url: string, init?: { withCredentials?: boolean }): EventSourceLike;
}

interface EventSourceLike {
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null;
  onerror: ((err: unknown) => void) | null;
  close(): void;
}

/**
 * Minimal Server-Sent Events driver. Uses the global `EventSource`
 * when available (browser, Bun, Deno), otherwise falls back to a
 * `ReadableStream` parser over `fetch`. Reconnects with exponential
 * backoff capped at `backoff.cap`. The `Last-Event-ID` header is
 * echoed so a server-side log can resume from the right offset.
 *
 * @returns An async `start` callback returning a `stop` function.
 */
export function startSseDriver(opts: SseDriverOptions): { stop: () => Promise<void> } {
  let active = true;
  let attempt = 0;
  let lastEventId: string | undefined;
  let abortController: AbortController | undefined;
  let nativeSource: EventSourceLike | undefined;

  function scheduleReconnect(): void {
    if (!active) return;
    const delay = backoffDelay(opts.backoff, attempt);
    setTimeout(() => {
      if (active) connect();
    }, delay);
  }

  function connect(): void {
    attempt += 1;
    const Native = (globalThis as { EventSource?: GlobalEventSourceCtor }).EventSource;
    if (Native !== undefined && typeof opts.url === 'string') {
      const source = new Native(opts.url);
      nativeSource = source;
      source.onmessage = (event) => {
        attempt = 0;
        if (event.lastEventId !== undefined) lastEventId = event.lastEventId;
        try {
          opts.onEvent(event.data);
        } catch (err) {
          opts.onError?.(err);
        }
      };
      source.onerror = (err) => {
        opts.onError?.(err);
        try {
          source.close();
        } catch {
          // ignore
        }
        nativeSource = undefined;
        scheduleReconnect();
      };
      return;
    }
    void runFetchSse();
  }

  async function runFetchSse(): Promise<void> {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      opts.onError?.(new Error('global fetch is unavailable'));
      return;
    }
    abortController = new AbortController();
    const headers = new Headers(opts.init?.headers);
    headers.set('Accept', 'text/event-stream');
    if (lastEventId !== undefined) headers.set('Last-Event-ID', lastEventId);
    try {
      const response = await fetchImpl(opts.url, {
        ...opts.init,
        headers,
        signal: abortController.signal,
      });
      if (!response.ok || response.body === null) {
        throw new Error(`SSE endpoint returned ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      attempt = 0;
      while (active) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value === undefined) continue;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const block of events) {
          parseEventBlock(block, (data, eventId) => {
            if (eventId !== undefined) lastEventId = eventId;
            try {
              opts.onEvent(data);
            } catch (err) {
              opts.onError?.(err);
            }
          });
        }
      }
    } catch (err) {
      opts.onError?.(err);
    } finally {
      abortController = undefined;
      if (active) scheduleReconnect();
    }
  }

  connect();

  return {
    stop: async () => {
      active = false;
      if (abortController !== undefined) {
        try {
          abortController.abort();
        } catch {
          // ignore
        }
      }
      if (nativeSource !== undefined) {
        try {
          nativeSource.close();
        } catch {
          // ignore
        }
        nativeSource = undefined;
      }
    },
  };
}

function parseEventBlock(
  block: string,
  emit: (data: string, eventId: string | undefined) => void,
): void {
  const lines = block.split(/\r?\n/);
  let data = '';
  let eventId: string | undefined;
  for (const line of lines) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value =
      colon === -1
        ? ''
        : line[colon + 1] === ' '
          ? line.slice(colon + 2)
          : line.slice(colon + 1);
    if (field === 'data') {
      data = data === '' ? value : `${data}\n${value}`;
    } else if (field === 'id') {
      eventId = value;
    }
  }
  if (data !== '') emit(data, eventId);
}
