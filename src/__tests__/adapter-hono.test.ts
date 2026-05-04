import { describe, expect, it, vi } from 'vitest';
import { honoFlags } from '../adapters/hono/index.js';
import { defineFlags } from '../core/define.js';

const flags = defineFlags({
  flags: {
    bool: { kind: 'boolean', default: false },
  },
});

function fakeContext(headers: Record<string, string> = {}) {
  const store = new Map<string, unknown>();
  const headerObject = new Headers(headers);
  return {
    req: {
      raw: { headers: headerObject } as never,
    },
    set(k: string, v: unknown) {
      store.set(k, v);
    },
    get<T>(k: string): T {
      return store.get(k) as T;
    },
    store,
  };
}

describe('honoFlags', () => {
  it('should set the flags handle and a typed flag accessor', async () => {
    const middleware = honoFlags(flags);
    const ctx = fakeContext();
    const next = vi.fn(async () => {});
    await middleware(ctx, next);
    expect(ctx.store.get('flags')).toBe(flags);
    const flag = ctx.store.get('flag') as (k: 'bool') => boolean;
    expect(flag('bool')).toBe(false);
    expect(next).toHaveBeenCalled();
  });

  it('should extract subject from a cookie header', async () => {
    const middleware = honoFlags(flags);
    const ctx = fakeContext({ cookie: 'devkit-flags-subject=u-1' });
    await middleware(ctx, async () => {});
    expect(ctx.store.get('flags')).toBe(flags);
  });

  it('should decode URL-encoded subject values', async () => {
    const middleware = honoFlags(flags);
    const ctx = fakeContext({ cookie: 'devkit-flags-subject=user%20one' });
    await middleware(ctx, async () => {});
    expect(ctx.store.get('flags')).toBe(flags);
  });

  it('should call extractSubject when provided', async () => {
    const extractSubject = vi.fn(() => ({ id: 'u-2' }));
    const middleware = honoFlags(flags, { extractSubject });
    const ctx = fakeContext();
    await middleware(ctx, async () => {});
    expect(extractSubject).toHaveBeenCalled();
  });
});
