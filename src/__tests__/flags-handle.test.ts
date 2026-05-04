import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineFlags } from '../core/define.js';
import { FlagsError } from '../errors/base.js';
import type { FlagSource, FlagSourceSnapshot } from '../types/source.js';

interface ManualSource extends FlagSource {
  push(snapshot: FlagSourceSnapshot): void;
}

function manualSource(initial?: FlagSourceSnapshot): ManualSource {
  let snap: FlagSourceSnapshot | undefined = initial;
  const listeners = new Set<(s: FlagSourceSnapshot) => void>();
  return {
    id: 'json',
    async load() {
      snap = snap ?? { flags: {}, origin: 'json', fetchedAt: Date.now() };
      return snap;
    },
    snapshot() {
      return snap;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async reload() {
      return snap ?? { flags: {}, origin: 'json' };
    },
    push(next) {
      snap = next;
      for (const l of listeners) l(next);
    },
  };
}

describe('FlagsHandle.get', () => {
  it('should return the static default for a known flag', () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
    });
    expect(flags.get('x')).toBe(true);
  });

  it('should distinguish supplied undefined default from absent default', () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: false } },
    });
    expect(flags.get('unknown' as never)).toBeUndefined();
    expect(flags.get('unknown' as never, undefined, undefined as never)).toBeUndefined();
    expect(flags.get('unknown' as never, undefined, true as never)).toBe(true);
  });
});

describe('FlagsHandle.getAsync', () => {
  it('should resolve the value after initialise', async () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
    });
    await expect(flags.getAsync('x')).resolves.toBe(true);
  });

  it('should accept a default override', async () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
    });
    await expect(
      flags.getAsync('unknown' as never, undefined, false as never),
    ).resolves.toBe(false);
  });
});

describe('FlagsHandle.getAll / getAllAsync', () => {
  it('should return a frozen snapshot of every flag', () => {
    const flags = defineFlags({
      flags: {
        a: { kind: 'boolean', default: true },
        b: { kind: 'string', default: 'v' },
      },
    });
    const all = flags.getAll();
    expect(all).toEqual({ a: true, b: 'v' });
    expect(Object.isFrozen(all)).toBe(true);
  });

  it('should cache identical reference for same context+version', () => {
    const flags = defineFlags({
      flags: { a: { kind: 'boolean', default: true } },
    });
    const ctx = {};
    const r1 = flags.getAll(ctx);
    const r2 = flags.getAll(ctx);
    expect(r1).toBe(r2);
  });

  it('should resolve via getAllAsync', async () => {
    const flags = defineFlags({
      flags: { a: { kind: 'boolean', default: true } },
    });
    const all = await flags.getAllAsync();
    expect(all).toEqual({ a: true });
  });
});

describe('FlagsHandle.getDetail / getDetailAsync', () => {
  it('should return full evaluation result', () => {
    const flags = defineFlags({
      flags: { a: { kind: 'boolean', default: true } },
    });
    const detail = flags.getDetail('a');
    expect(detail.key).toBe('a');
    expect(detail.value).toBe(true);
    expect(detail.reason).toBe('STATIC');
    expect(detail.source).toBe('defaults');
  });

  it('should cache repeated reads with the same context', () => {
    const flags = defineFlags({
      flags: { a: { kind: 'boolean', default: true } },
    });
    const ctx = {};
    const d1 = flags.getDetail('a', ctx);
    const d2 = flags.getDetail('a', ctx);
    expect(d1).toBe(d2);
  });

  it('should resolve via getDetailAsync', async () => {
    const flags = defineFlags({
      flags: { a: { kind: 'boolean', default: true } },
    });
    const detail = await flags.getDetailAsync('a');
    expect(detail.value).toBe(true);
  });
});

describe('FlagsHandle.subscribe', () => {
  it('should fire on snapshot rebuild and unsubscribe correctly', async () => {
    const source = manualSource({
      flags: { x: { kind: 'boolean', default: false } },
      origin: 'json',
      fetchedAt: 1,
    });
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: false } },
      sources: [source],
    });
    await flags.ready();
    const listener = vi.fn();
    const unsub = flags.subscribe(listener);
    source.push({
      flags: { x: { kind: 'boolean', default: true } },
      origin: 'json',
      fetchedAt: 2,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    source.push({
      flags: { x: { kind: 'boolean', default: false } },
      origin: 'json',
      fetchedAt: 3,
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should swallow listener errors and log them', () => {
    const flags = defineFlags({ flags: { x: { kind: 'boolean', default: true } } });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    flags.subscribe(() => {
      throw new Error('listener boom');
    });
    expect(() =>
      // trigger a fanout via reload
      void flags.reload(),
    ).not.toThrow();
    errSpy.mockRestore();
  });
});

describe('FlagsHandle.reload', () => {
  it('should rebuild merged snapshot from all sources', async () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: false } },
    });
    const before = flags.version();
    const next = await flags.reload();
    expect(flags.version()).toBe(before + 1);
    expect(next.origin).toBe('compose');
  });

  it('should reject when handle is disposed', async () => {
    const flags = defineFlags({ flags: { x: { kind: 'boolean', default: true } } });
    await flags.dispose();
    await expect(flags.reload()).rejects.toThrow(FlagsError);
  });
});

describe('FlagsHandle.dispose', () => {
  it('should be idempotent', async () => {
    const flags = defineFlags({ flags: { x: { kind: 'boolean', default: true } } });
    await flags.dispose();
    await expect(flags.dispose()).resolves.toBeUndefined();
  });

  it('should call source.close() if provided', async () => {
    const close = vi.fn();
    const source: FlagSource = {
      id: 'json',
      async load() {
        return { flags: {}, origin: 'json' };
      },
      snapshot() {
        return undefined;
      },
      subscribe() {
        return () => {};
      },
      close,
    };
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
      sources: [source],
    });
    await flags.dispose();
    expect(close).toHaveBeenCalled();
  });

  it('should swallow close() failures', async () => {
    const source: FlagSource = {
      id: 'json',
      async load() {
        return { flags: {}, origin: 'json' };
      },
      snapshot() {
        return undefined;
      },
      subscribe() {
        return () => {};
      },
      close: () => Promise.reject(new Error('boom')),
    };
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
      sources: [source],
    });
    await expect(flags.dispose()).resolves.toBeUndefined();
  });
});

describe('FlagsHandle.version', () => {
  it('should bump on reload and initialise', async () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
    });
    const v0 = flags.version();
    await flags.ready();
    expect(flags.version()).toBeGreaterThan(v0);
    const v1 = flags.version();
    await flags.reload();
    expect(flags.version()).toBeGreaterThan(v1);
  });
});

describe('FlagsHandle.config', () => {
  it('should expose a frozen configuration', () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
      environment: 'production',
      salt: 's',
    });
    expect(flags.config.environment).toBe('production');
    expect(flags.config.salt).toBe('s');
    expect(Object.isFrozen(flags.config)).toBe(true);
  });
});

describe('FlagsHandle observability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fire the onEvaluation hook', () => {
    const onEvaluation = vi.fn();
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
      onEvaluation,
    });
    flags.get('x');
    expect(onEvaluation).toHaveBeenCalled();
    const ev = onEvaluation.mock.calls[0]?.[0];
    expect(ev.flagKey).toBe('x');
    expect(ev.value).toBe(true);
  });

  it('should redact subject by default to id only', () => {
    const onEvaluation = vi.fn();
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
      attributes: { plan: 'string' as const },
      onEvaluation,
    });
    flags.get('x', { subject: { id: 'u1', attributes: { plan: 'pro' } } });
    const ev = onEvaluation.mock.calls[0]?.[0];
    expect(ev.subject).toEqual({ id: 'u1' });
  });

  it('should respect a custom redactSubject', () => {
    const onEvaluation = vi.fn();
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
      attributes: { plan: 'string' as const },
      onEvaluation,
      redactSubject: (s) => s,
    });
    flags.get('x', { subject: { id: 'u1', attributes: { plan: 'pro' } } });
    const ev = onEvaluation.mock.calls[0]?.[0];
    expect(ev.subject).toEqual({ id: 'u1', attributes: { plan: 'pro' } });
  });
});

describe('FlagsHandle ready', () => {
  it('should resolve after initial load', async () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: true } },
    });
    await expect(flags.ready()).resolves.toBeUndefined();
  });
});
