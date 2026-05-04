import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../cli/index.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devkit-flags-cli-main-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('main', () => {
  it('should print help and return 0 when called with no args', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await main([]);
    expect(code).toBe(0);
    expect(out).toHaveBeenCalled();
  });

  it('should print help on --help', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(await main(['--help'])).toBe(0);
  });

  it('should return 2 on unknown command', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await main(['mystery'])).toBe(2);
  });

  it('should return 1 on missing argument', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await main(['lint'])).toBe(1);
  });

  it('should run audit and return 0', async () => {
    const file = join(dir, 'flags.json');
    await writeFile(file, JSON.stringify({ flags: {} }));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(await main(['audit', '--in', file])).toBe(0);
  });

  it('should run audit with --json', async () => {
    const file = join(dir, 'flags.json');
    await writeFile(file, JSON.stringify({ flags: {} }));
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(await main(['audit', '--in', file, '--json'])).toBe(0);
    const written = (out.mock.calls[0]?.[0] ?? '') as string;
    expect(() => JSON.parse(written)).not.toThrow();
  });

  it('should run lint and return 0 on clean project', async () => {
    const file = join(dir, 'flags.json');
    await writeFile(file, JSON.stringify({ flags: {} }));
    const fs = await import('node:fs/promises');
    await fs.mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src', 'a.ts'), '/* empty */');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(await main(['lint', '--in', file, '--src', join(dir, 'src')])).toBe(0);
  });

  it('should return 1 from lint when issues are found', async () => {
    const file = join(dir, 'flags.json');
    await writeFile(
      file,
      JSON.stringify({ flags: { x: { kind: 'boolean', default: false } } }),
    );
    const fs = await import('node:fs/promises');
    await fs.mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src', 'a.ts'), `flags.get('orphan');`);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(await main(['lint', '--in', file, '--src', join(dir, 'src')])).toBe(1);
  });

  it('should run codegen', async () => {
    const inFile = join(dir, 'flags.json');
    const outFile = join(dir, 'out.ts');
    await writeFile(
      inFile,
      JSON.stringify({ flags: { x: { kind: 'boolean', default: false } } }),
    );
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(await main(['codegen', '--in', inFile, '--out', outFile])).toBe(0);
  });

  it('should return 1 on FlagsError thrown internally', async () => {
    const inFile = join(dir, 'flags.json');
    await writeFile(inFile, '{not json}');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await main(['audit', '--in', inFile])).toBe(1);
  });
});
