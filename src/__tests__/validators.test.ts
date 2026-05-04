import { describe, expect, it } from 'vitest';
import { FlagsError } from '../errors/base.js';
import { validate, validateSync } from '../validators/standard-schema/index.js';
import type { StandardSchemaV1 } from '../types/flag-spec.js';

const stub = (
  fn: (v: unknown) => { value: unknown } | { issues: { message: string }[] },
): StandardSchemaV1 => ({
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: fn,
  } as StandardSchemaV1['~standard'],
});

const asyncStub = (
  fn: (v: unknown) =>
    | { value: unknown }
    | { issues: { message: string }[] }
    | Promise<{ value: unknown } | { issues: { message: string }[] }>,
): StandardSchemaV1 => ({
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: fn,
  } as StandardSchemaV1['~standard'],
});

describe('validate (async)', () => {
  it('should return ok=true on a successful validator', async () => {
    const schema = stub((v) => ({ value: v }));
    const r = await validate(schema, 42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('should return ok=false with FlagsError on issues', async () => {
    const schema = stub(() => ({ issues: [{ message: 'bad' }] }));
    const r = await validate(schema, null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(FlagsError);
      expect(r.error.code).toBe('JSON_SCHEMA_ERROR');
    }
  });

  it('should reject non-Standard-Schema values', async () => {
    const r = await validate({} as never, null);
    expect(r.ok).toBe(false);
  });

  it('should wrap thrown validators', async () => {
    const schema = stub(() => {
      throw new Error('boom');
    });
    const r = await validate(schema, null);
    expect(r.ok).toBe(false);
  });

  it('should await async validators', async () => {
    const schema = asyncStub(async (v) => Promise.resolve({ value: v }));
    const r = await validate(schema, 1);
    expect(r.ok && r.value).toBe(1);
  });
});

describe('validateSync', () => {
  it('should validate synchronously', () => {
    const schema = stub((v) => ({ value: v }));
    const r = validateSync(schema, 'x');
    expect(r.ok && r.value).toBe('x');
  });

  it('should reject if validator returned a Promise', () => {
    const schema = asyncStub(async () => Promise.resolve({ value: 1 }));
    const r = validateSync(schema, 1);
    expect(r.ok).toBe(false);
  });

  it('should return issues as ok=false', () => {
    const schema = stub(() => ({ issues: [{ message: 'bad' }] }));
    const r = validateSync(schema, 1);
    expect(r.ok).toBe(false);
  });

  it('should reject non-Standard-Schema values', () => {
    expect(validateSync(null as never, 0).ok).toBe(false);
  });

  it('should wrap thrown validators', () => {
    const schema = stub(() => {
      throw new Error('boom');
    });
    const r = validateSync(schema, 1);
    expect(r.ok).toBe(false);
  });
});
