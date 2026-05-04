import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveEnvironment } from '../core/env.js';

describe('resolveEnvironment', () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env['NODE_ENV'];
    delete process.env['ENVIRONMENT'];
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
  });

  it('should prefer the override argument over everything else', () => {
    process.env['NODE_ENV'] = 'production';
    expect(resolveEnvironment('staging', 'preview')).toBe('preview');
  });

  it('should treat empty override as absent and fall through to configured', () => {
    expect(resolveEnvironment('staging', '')).toBe('staging');
  });

  it('should use the configured value when no override', () => {
    expect(resolveEnvironment('dev')).toBe('dev');
  });

  it('should treat empty configured as absent', () => {
    process.env['NODE_ENV'] = 'test';
    expect(resolveEnvironment('')).toBe('test');
  });

  it('should fall back to NODE_ENV when no explicit config', () => {
    process.env['NODE_ENV'] = 'staging';
    expect(resolveEnvironment()).toBe('staging');
  });

  it('should fall back to ENVIRONMENT when NODE_ENV is unset', () => {
    process.env['ENVIRONMENT'] = 'preview';
    expect(resolveEnvironment()).toBe('preview');
  });

  it('should fall back to "production" when no env-vars are set', () => {
    expect(resolveEnvironment()).toBe('production');
  });

  it('should ignore empty NODE_ENV', () => {
    process.env['NODE_ENV'] = '';
    process.env['ENVIRONMENT'] = 'preview';
    expect(resolveEnvironment()).toBe('preview');
  });
});
