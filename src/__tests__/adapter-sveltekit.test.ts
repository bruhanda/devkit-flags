import { describe, expect, it, vi } from 'vitest';
import { flagsHandle } from '../adapters/sveltekit/index.js';
import { defineFlags } from '../core/define.js';

const flags = defineFlags({
  flags: { bool: { kind: 'boolean', default: true } },
});

function makeEvent(cookieValue?: string) {
  return {
    cookies: {
      get(name: string) {
        return name === 'devkit-flags-subject' ? cookieValue : undefined;
      },
    },
    request: { headers: new Headers() },
    url: new URL('http://localhost/'),
    locals: {} as Record<string, unknown>,
  };
}

describe('flagsHandle', () => {
  it('should populate event.locals.flags with handle and accessors', async () => {
    const handle = flagsHandle(flags);
    const event = makeEvent('u-1');
    const resolve = vi.fn(async () => new Response(''));
    await handle({ event, resolve });
    expect(event.locals['flags']).toBeDefined();
    const local = event.locals['flags'] as {
      handle: typeof flags;
      get: <K extends 'bool'>(k: K) => unknown;
      getDetail: <K extends 'bool'>(k: K) => unknown;
    };
    expect(local.handle).toBe(flags);
    expect(typeof local.get).toBe('function');
    expect(typeof local.getDetail).toBe('function');
    expect(local.get('bool')).toBe(true);
  });

  it('should respect custom localsKey', async () => {
    const handle = flagsHandle(flags, { localsKey: 'ff' });
    const event = makeEvent();
    await handle({ event, resolve: async () => new Response('') });
    expect(event.locals['ff']).toBeDefined();
  });

  it('should call extractSubject when provided', async () => {
    const extract = vi.fn(() => ({ id: 'u-2' }));
    const handle = flagsHandle(flags, { extractSubject: extract });
    const event = makeEvent();
    await handle({ event, resolve: async () => new Response('') });
    expect(extract).toHaveBeenCalled();
  });
});
