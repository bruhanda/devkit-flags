import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSseDriver } from '../sources/remote/sse.js';

describe('startSseDriver: native EventSource', () => {
  afterEach(() => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
  });

  it('should use native EventSource when available', () => {
    const close = vi.fn();
    let onmessage: ((ev: { data: string }) => void) | null = null;
    class FakeES {
      onmessage: ((ev: { data: string }) => void) | null = null;
      onerror: ((err: unknown) => void) | null = null;
      constructor() {
        // capture for tests
        setTimeout(() => {
          onmessage = this.onmessage;
        }, 0);
      }
      close = close;
    }
    (globalThis as { EventSource?: unknown }).EventSource =
      FakeES as unknown as typeof EventSource;
    const onEvent = vi.fn();
    const driver = startSseDriver({
      url: 'https://x',
      backoff: { base: 10, cap: 100 },
      onEvent,
    });
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        if (onmessage !== null) {
          onmessage({ data: '{"hello":"world"}' });
        }
        expect(onEvent).toHaveBeenCalled();
        void driver.stop().then(() => {
          expect(close).toHaveBeenCalled();
          resolve();
        });
      }, 5);
    });
  });
});

describe('startSseDriver: fetch fallback', () => {
  afterEach(() => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
    vi.restoreAllMocks();
  });

  it('should parse SSE events from a streaming Response', async () => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
    const events: string[] = [];
    const onEvent = vi.fn((data: string) => events.push(data));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: hello\n\n'));
        controller.enqueue(new TextEncoder().encode('id: 42\ndata: world\n\n'));
        controller.close();
      },
    });
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )) as typeof fetch;
    const driver = startSseDriver({
      url: 'https://x',
      backoff: { base: 1, cap: 10 },
      fetchImpl,
      onEvent,
    });
    await new Promise((r) => setTimeout(r, 50));
    await driver.stop();
    expect(events).toContain('hello');
    expect(events).toContain('world');
  });

  it('should emit onError and stop cleanly on fetch failure', async () => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
    const onError = vi.fn();
    const fetchImpl = (() =>
      Promise.reject(new Error('boom'))) as typeof fetch;
    const driver = startSseDriver({
      url: 'https://x',
      backoff: { base: 1, cap: 5 },
      fetchImpl,
      onEvent: () => {},
      onError,
    });
    await new Promise((r) => setTimeout(r, 30));
    await driver.stop();
    expect(onError).toHaveBeenCalled();
  });
});
