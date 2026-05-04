import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAudit } from '../cli/audit.js';
import { runCodegen } from '../cli/codegen.js';
import { walkSources } from '../cli/fs-walk.js';
import { runLint } from '../cli/lint.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devkit-flags-cli-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const baseFlagsJson = {
  flags: {
    newCheckout: {
      kind: 'boolean',
      default: false,
      description: 'enables the new checkout',
      tags: ['critical'],
    },
    deprecated_one: {
      kind: 'boolean',
      default: false,
      deprecated: true,
    },
  },
};

describe('runAudit', () => {
  it('should produce a report from flags.json', async () => {
    const file = join(dir, 'flags.json');
    await writeFile(file, JSON.stringify(baseFlagsJson));
    const report = await runAudit({ flagsJsonPath: file });
    expect(report.count).toBe(2);
    expect(report.deprecatedCount).toBe(1);
    expect(report.entries[0]?.key).toBe('newCheckout');
    expect(report.entries[0]?.description).toBe('enables the new checkout');
  });
});

describe('runLint', () => {
  it('should report dead and unknown flags', async () => {
    const file = join(dir, 'flags.json');
    await writeFile(file, JSON.stringify(baseFlagsJson));
    const srcDir = join(dir, 'src');
    await writeFile(
      `${srcDir}-stub.ts`,
      `import x from 'y';\n`,
    ).catch(() => {});
    // Build a small src dir
    const fs = await import('node:fs/promises');
    await fs.mkdir(srcDir);
    await writeFile(
      join(srcDir, 'a.ts'),
      `flags.get('newCheckout');\nflags.get('orphanFlag');\n`,
    );
    const report = await runLint({ flagsJsonPath: file, srcRoot: srcDir });
    expect(report.dead).toContain('deprecated_one');
    expect(report.unknown.some((u) => u.key === 'orphanFlag')).toBe(true);
  });
});

describe('runCodegen', () => {
  it('should produce a typed defineFlags module', async () => {
    const inFile = join(dir, 'flags.json');
    const outFile = join(dir, 'flags.gen.ts');
    await writeFile(
      inFile,
      JSON.stringify({
        flags: {
          variant: {
            kind: 'string',
            default: 'a',
            values: ['a', 'b'],
          },
          plain: {
            kind: 'boolean',
            default: false,
          },
        },
        segments: { pro: { plan: { eq: 'pro' } } },
      }),
    );
    await runCodegen({ inPath: inFile, outPath: outFile });
    const text = await readFile(outFile, { encoding: 'utf8' });
    expect(text).toContain("import { defineFlags } from '@devkit/flags'");
    expect(text).toContain('variant');
    expect(text).toContain('as const');
    expect(text).toContain('segments');
  });
});

describe('walkSources', () => {
  it('should yield ts/js files and skip configured dirs', async () => {
    const fs = await import('node:fs/promises');
    await fs.mkdir(join(dir, 'src'));
    await fs.mkdir(join(dir, 'src', 'node_modules'));
    await writeFile(join(dir, 'src', 'a.ts'), 'export const x = 1;');
    await writeFile(join(dir, 'src', 'b.tsx'), 'export const x = 1;');
    await writeFile(join(dir, 'src', 'data.json'), '{}');
    await writeFile(join(dir, 'src', 'node_modules', 'skip.ts'), 'noop');
    const seen: string[] = [];
    for await (const file of walkSources(join(dir, 'src'))) {
      seen.push(file);
    }
    expect(seen.some((f) => f.endsWith('a.ts'))).toBe(true);
    expect(seen.some((f) => f.endsWith('b.tsx'))).toBe(true);
    expect(seen.some((f) => f.endsWith('data.json'))).toBe(false);
    expect(seen.some((f) => f.includes('node_modules'))).toBe(false);
  });

  it('should not throw on a missing directory', async () => {
    const seen: string[] = [];
    for await (const f of walkSources(join(dir, 'nonExistent'))) {
      seen.push(f);
    }
    expect(seen).toEqual([]);
  });
});
