import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchEvaluation,
  idOnlyRedactor,
  redactSubject,
} from '../core/observe.js';

describe('idOnlyRedactor', () => {
  it('should keep only the id field', () => {
    const result = idOnlyRedactor({ id: 'u1', attributes: { plan: 'pro' as never } });
    expect(result).toEqual({ id: 'u1' });
  });
});

describe('redactSubject', () => {
  it('should return undefined when subject is absent', () => {
    expect(redactSubject(undefined, undefined)).toBeUndefined();
  });

  it('should default to id-only redaction', () => {
    const out = redactSubject(
      { id: 'u', attributes: { plan: 'pro' as never } },
      undefined,
    );
    expect(out).toEqual({ id: 'u' });
  });

  it('should accept a custom redactor that forwards everything', () => {
    const out = redactSubject(
      { id: 'u', attributes: { plan: 'pro' as never } },
      (s) => s,
    );
    expect(out).toEqual({ id: 'u', attributes: { plan: 'pro' } });
  });

  it('should fall back to id when redactor strips it', () => {
    const out = redactSubject(
      { id: 'u', attributes: { plan: 'pro' as never } },
      () => ({}),
    );
    expect(out).toEqual({ id: 'u' });
  });
});

describe('dispatchEvaluation', () => {
  const ev = {
    flagKey: 'x',
    value: true,
    reason: 'STATIC' as const,
    environment: 'production',
    elapsedMs: 0,
    timestamp: 0,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be a no-op when hook is undefined', () => {
    expect(() => dispatchEvaluation(undefined, ev)).not.toThrow();
  });

  it('should call the hook with the event', () => {
    const hook = vi.fn();
    dispatchEvaluation(hook, ev);
    expect(hook).toHaveBeenCalledWith(ev);
  });

  it('should swallow synchronous throws and log the error', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hook = () => {
      throw new Error('boom');
    };
    expect(() => dispatchEvaluation(hook, ev)).not.toThrow();
    expect(errSpy).toHaveBeenCalled();
  });

  it('should swallow async rejections', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hook = () => Promise.reject(new Error('boom'));
    dispatchEvaluation(hook, ev);
    await new Promise((r) => setTimeout(r, 10));
    expect(errSpy).toHaveBeenCalled();
  });
});
