import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineFlags } from '../core/define.js';
import { FlagsError } from '../errors/base.js';
import { createJsonSource } from '../sources/json/index.js';

describe('createJsonSource: object input', () => {
  it('should overlay an inline JSON object', async () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: false } },
      sources: [
        createJsonSource({
          flags: { x: { kind: 'boolean', default: true } },
        }),
      ],
    });
    await flags.ready();
    expect(flags.get('x')).toBe(true);
  });

  it('should reload via .reload()', async () => {
    const source = createJsonSource({
      flags: { x: { kind: 'boolean', default: true } },
    });
    const next = await source.reload!();
    expect(next.flags['x']).toBeDefined();
  });
});

describe('createJsonSource: function input', () => {
  it('should call the producer to get the payload', async () => {
    const flags = defineFlags({
      flags: { x: { kind: 'boolean', default: false } },
      sources: [
        createJsonSource(async () => ({
          flags: { x: { kind: 'boolean', default: true } },
        })),
      ],
    });
    await flags.ready();
    expect(flags.get('x')).toBe(true);
  });
});

describe('createJsonSource: file input', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'devkit-flags-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('should load from a JSON file', async () => {
    const file = join(dir, 'flags.json');
    await writeFile(
      file,
      JSON.stringify({
        flags: { x: { kind: 'boolean', default: true } },
      }),
    );
    const source = createJsonSource(file);
    const snap = await source.load();
    expect((snap.flags['x'] as { default: boolean }).default).toBe(true);
  });

  it('should close cleanly even without an active watcher', async () => {
    const file = join(dir, 'flags.json');
    await writeFile(
      file,
      JSON.stringify({
        flags: { x: { kind: 'boolean', default: true } },
      }),
    );
    const source = createJsonSource(file);
    await source.load();
    await expect(source.close!()).resolves.toBeUndefined();
  });
});

describe('createJsonSource: URL input', () => {
  it('should reject when URL fetch fails non-2xx', async () => {
    const url = new URL('https://invalid-host.example.test/flags.json');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response('not found', { status: 404 }),
      )) as typeof fetch;
    try {
      const source = createJsonSource(url);
      await expect(source.load()).rejects.toThrow(FlagsError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should accept a successful URL fetch', async () => {
    const url = new URL('https://invalid-host.example.test/flags.json');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ flags: { x: { kind: 'boolean', default: true } } }),
          { status: 200 },
        ),
      )) as typeof fetch;
    try {
      const source = createJsonSource(url);
      const snap = await source.load();
      expect((snap.flags['x'] as { default: boolean }).default).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
