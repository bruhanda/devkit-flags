import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineFlags } from '../core/define.js';
import { FlagsError } from '../errors/base.js';
import { createEnvSource } from '../sources/env/index.js';
import { normalizeFlagKey } from '../sources/env/normalize-key.js';

describe('normalizeFlagKey', () => {
  it('should convert camelCase to SCREAMING_SNAKE', () => {
    expect(normalizeFlagKey('newCheckout')).toBe('NEW_CHECKOUT');
  });

  it('should convert kebab-case to SCREAMING_SNAKE', () => {
    expect(normalizeFlagKey('experimental-A')).toBe('EXPERIMENTAL_A');
  });

  it('should keep consecutive uppercase together', () => {
    expect(normalizeFlagKey('URLBase')).toBe('URL_BASE');
  });

  it('should handle plain lowercase', () => {
    expect(normalizeFlagKey('flag')).toBe('FLAG');
  });
});

describe('createEnvSource', () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env['FLAG_X'];
    delete process.env['FLAG_NEW_CHECKOUT'];
    delete process.env['FLAG_BOGUS_KEY'];
    delete process.env['FLAG_VARIANT'];
    delete process.env['FLAG_NUM'];
    delete process.env['FLAG_JSON_CONFIG'];
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
    vi.restoreAllMocks();
  });

  it('should overlay a boolean from env', async () => {
    process.env['FLAG_NEW_CHECKOUT'] = 'true';
    const flags = defineFlags({
      flags: { newCheckout: { kind: 'boolean', default: false } },
      sources: [createEnvSource()],
    });
    await flags.ready();
    expect(flags.get('newCheckout')).toBe(true);
  });

  it('should coerce a number from env and clamp to range', async () => {
    process.env['FLAG_NUM'] = '999';
    const flags = defineFlags({
      flags: { num: { kind: 'number', default: 0, range: [0, 10] as const } },
      sources: [createEnvSource()],
    });
    await flags.ready();
    expect(flags.get('num')).toBe(10);
  });

  it('should drop env values not in declared values list', async () => {
    process.env['FLAG_VARIANT'] = 'invalid';
    const flags = defineFlags({
      flags: {
        variant: {
          kind: 'string',
          default: 'a',
          values: ['a', 'b'] as const,
        },
      },
      sources: [createEnvSource()],
    });
    await flags.ready();
    expect(flags.get('variant')).toBe('a');
  });

  it('should accept JSON values', async () => {
    process.env['FLAG_JSON_CONFIG'] = '{"foo":"bar"}';
    const flags = defineFlags({
      flags: { jsonConfig: { kind: 'json', default: {} } },
      sources: [createEnvSource()],
    });
    await flags.ready();
    expect(flags.get('jsonConfig')).toEqual({ foo: 'bar' });
  });

  it('should support custom prefix', async () => {
    process.env['MYAPP_X'] = 'true';
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: false } },
      sources: [createEnvSource({ prefix: 'MYAPP_' })],
    });
    await flags.ready();
    expect(flags.get('x')).toBe(true);
    delete process.env['MYAPP_X'];
  });

  it('should support explicit env bag', async () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: false } },
      sources: [createEnvSource({ env: { FLAG_X: '1' } })],
    });
    await flags.ready();
    expect(flags.get('x')).toBe(true);
  });

  it('should warn on unknown FLAG_ prefixed env-vars', async () => {
    process.env['FLAG_BOGUS_KEY'] = '1';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: false } },
      sources: [createEnvSource()],
    });
    await flags.ready();
    flags.get('x');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('FLAG_BOGUS_KEY'),
    );
  });

  it('should support allow="*" for untargeted scanning', async () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: false } },
      sources: [
        createEnvSource({
          allow: '*',
          env: { FLAG_X: 'true', UNKNOWN: 'noise' },
        }),
      ],
    });
    await flags.ready();
    expect(flags.get('x')).toBe(true);
  });

  it('should respect explicit allowlist', async () => {
    const flags = defineFlags({
      flags: {
        x: { kind: 'boolean', default: false },
        y: { kind: 'boolean', default: false },
      },
      sources: [
        createEnvSource({
          allow: ['x'],
          env: { FLAG_X: 'true', FLAG_Y: 'true' },
        }),
      ],
    });
    await flags.ready();
    expect(flags.get('x')).toBe(true);
    expect(flags.get('y')).toBe(false);
  });

  it('should support reload', async () => {
    const env = { FLAG_X: 'true' };
    const source = createEnvSource({ env });
    await source.load();
    env.FLAG_X = 'false';
    const snap = await source.reload!();
    expect((snap.flags['x'] as { default: boolean })?.default ?? null).not.toBe(
      undefined,
    );
  });

  it('should throw on Workers without explicit env', async () => {
    const { _resetRuntimeCacheForTests } = await import('../utils/runtime.js');
    const g = globalThis as { EdgeRuntime?: unknown };
    const originalEdge = g.EdgeRuntime;
    g.EdgeRuntime = 'edge-runtime-marker';
    _resetRuntimeCacheForTests();
    try {
      expect(() => createEnvSource()).toThrow(FlagsError);
    } finally {
      g.EdgeRuntime = originalEdge;
      _resetRuntimeCacheForTests();
    }
  });
});
