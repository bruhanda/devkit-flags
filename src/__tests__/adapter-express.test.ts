import { describe, expect, it, vi } from 'vitest';
import { expressFlags } from '../adapters/express/index.js';
import { defineFlags } from '../core/define.js';

const flags = defineFlags({
  flags: {
    f: {
      kind: 'boolean',
      default: false,
      rules: [{ when: { plan: { eq: 'pro' } }, value: true }],
    },
  },
  attributes: { plan: 'string' as const },
});

describe('expressFlags', () => {
  it('should attach flags + flag accessor to req', () => {
    const middleware = expressFlags(flags);
    const next = vi.fn();
    const req: { headers: Record<string, string>; flags?: unknown; flag?: (k: string) => unknown } = {
      headers: {},
    };
    middleware(req as never, {} as never, next);
    expect(req.flags).toBe(flags);
    expect(typeof req.flag).toBe('function');
    expect(next).toHaveBeenCalled();
  });

  it('should extract subject from cookie header', () => {
    const middleware = expressFlags(flags);
    const next = vi.fn();
    const captured: { id: string }[] = [];
    const customMiddleware = expressFlags(flags, {
      extractSubject: (r) => {
        const cookie = r.headers['cookie'];
        if (typeof cookie === 'string' && cookie.includes('id=')) {
          const id = cookie.split('id=')[1] ?? '';
          captured.push({ id });
          return { id };
        }
        return undefined;
      },
    });
    const req = { headers: { cookie: 'id=u-7' } };
    customMiddleware(req as never, {} as never, next);
    middleware(req as never, {} as never, next);
    expect(captured).toEqual([{ id: 'u-7' }]);
  });

  it('should use cookies via req.cookies when present', () => {
    const middleware = expressFlags(flags, { cookieName: 'sub' });
    const next = vi.fn();
    const req: {
      headers: Record<string, string>;
      cookies?: Record<string, unknown>;
      flag?: (k: string) => unknown;
    } = {
      headers: {},
      cookies: { sub: 'cookie-id' },
    };
    middleware(req as never, {} as never, next);
    expect(typeof req.flag).toBe('function');
  });

  it('should decode URL-encoded cookie values from header', () => {
    const middleware = expressFlags(flags);
    const next = vi.fn();
    const req: {
      headers: Record<string, string>;
      flag?: (k: string) => unknown;
    } = {
      headers: { cookie: 'devkit-flags-subject=foo%20bar' },
    };
    middleware(req as never, {} as never, next);
    expect(typeof req.flag).toBe('function');
  });
});
