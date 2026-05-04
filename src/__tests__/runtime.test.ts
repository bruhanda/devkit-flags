import { describe, expect, it } from 'vitest';
import {
  _resetRuntimeCacheForTests,
  detectRuntime,
  readHostEnv,
} from '../utils/runtime.js';

describe('detectRuntime', () => {
  it('should detect node when running under vitest on Node', () => {
    _resetRuntimeCacheForTests();
    expect(detectRuntime()).toBe('node');
  });

  it('should cache the result', () => {
    _resetRuntimeCacheForTests();
    const a = detectRuntime();
    const b = detectRuntime();
    expect(a).toBe(b);
  });
});

describe('readHostEnv', () => {
  it('should return process.env on node', () => {
    _resetRuntimeCacheForTests();
    process.env['__DEVKIT_FLAGS_TEST_VAR__'] = 'present';
    const env = readHostEnv();
    expect(env['__DEVKIT_FLAGS_TEST_VAR__']).toBe('present');
    delete process.env['__DEVKIT_FLAGS_TEST_VAR__'];
  });

  it('should return a record-shaped object', () => {
    const env = readHostEnv();
    expect(typeof env).toBe('object');
  });
});
