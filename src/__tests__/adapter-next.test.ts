import { describe, expect, it, vi } from 'vitest';
import {
  createFlagsRoute,
  flagsMiddleware,
  getFlag,
} from '../adapters/next/index.js';
import { defineFlags } from '../core/define.js';

const flags = defineFlags({
  flags: { bool: { kind: 'boolean', default: true } },
});

describe('getFlag', () => {
  it('should resolve via getAsync', async () => {
    expect(await getFlag(flags, 'bool')).toBe(true);
  });
});

describe('createFlagsRoute', () => {
  it('should respond 200 with the merged snapshot as JSON', async () => {
    const handler = createFlagsRoute(flags);
    const res = await handler({} as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flags).toBeDefined();
  });
});

describe('flagsMiddleware', () => {
  it('should set the subject header from a cookie', () => {
    const middleware = flagsMiddleware(flags);
    const headers = new Map<string, string>();
    const res = {
      headers: { set: (k: string, v: string) => headers.set(k, v) },
    };
    const req = {
      cookies: {
        get: (name: string) =>
          name === 'devkit-flags-subject' ? { value: 'u-1' } : undefined,
      },
      headers: { get: () => null },
    };
    middleware(req as never, res as never);
    expect(headers.get('x-flags-subject')).toBe('u-1');
  });

  it('should not set header when no cookie', () => {
    const middleware = flagsMiddleware(flags);
    const headers = new Map<string, string>();
    const res = {
      headers: { set: (k: string, v: string) => headers.set(k, v) },
    };
    const req = {
      cookies: { get: () => undefined },
      headers: { get: () => null },
    };
    middleware(req as never, res as never);
    expect(headers.get('x-flags-subject')).toBeUndefined();
  });

  it('should support custom extractSubject', () => {
    const extract = vi.fn(() => ({ id: 'extracted' }));
    const middleware = flagsMiddleware(flags, { extractSubject: extract });
    const headers = new Map<string, string>();
    const res = {
      headers: { set: (k: string, v: string) => headers.set(k, v) },
    };
    const req = {
      cookies: { get: () => undefined },
      headers: { get: () => null },
    };
    middleware(req as never, res as never);
    expect(headers.get('x-flags-subject')).toBe('extracted');
  });
});
