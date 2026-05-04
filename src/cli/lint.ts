import { FlagsError } from '../errors/base.js';
import { parseFlagsJson } from '../sources/json/parse.js';
import { detectRuntime } from '../utils/runtime.js';
import { walkSources } from './fs-walk.js';

const FLAG_CALL_PATTERN =
  /\bflags?\s*(?:\.get(?:Async|Detail|DetailAsync)?|\.peek)?\s*\(\s*['"`]([^'"`]+)['"`]/g;
const USE_FLAG_PATTERN = /\buseFlag(?:Result)?\s*\(\s*['"`]([^'"`]+)['"`]/g;

/**
 * Result of `runLint`. `dead` are flag keys declared in `flags.json`
 * but never read in the source tree; `unknown` are keys read in code
 * but never declared.
 */
export interface LintReport {
  readonly dead: readonly string[];
  readonly unknown: readonly { readonly key: string; readonly file: string }[];
}

interface LintOptions {
  readonly flagsJsonPath: string;
  readonly srcRoot: string;
  readonly format?: 'text' | 'json';
}

/**
 * Lint a project's flag usage. Reports flags declared in
 * `flags.json` but never read (dead flags) and keys read in code
 * but missing from `flags.json` (typos / orphans).
 *
 * @param opts  Input paths + output format.
 * @returns     Structured report. The CLI also prints to stdout.
 *
 * @example
 *   await runLint({ flagsJsonPath: 'flags.json', srcRoot: 'src' });
 */
export async function runLint(opts: LintOptions): Promise<LintReport> {
  const runtime = detectRuntime();
  if (runtime !== 'node' && runtime !== 'bun') {
    throw new FlagsError('INVALID_RUNTIME_OPTION', 'lint requires Node.js or Bun');
  }
  const fs = await import('node:fs/promises');
  const raw = await fs.readFile(opts.flagsJsonPath, { encoding: 'utf8' });
  const parsed = parseFlagsJson(raw);
  const declared = new Set(Object.keys(parsed.flags));
  const seen = new Set<string>();
  const unknown: { key: string; file: string }[] = [];

  for await (const file of walkSources(opts.srcRoot)) {
    let contents: string;
    try {
      contents = await fs.readFile(file, { encoding: 'utf8' });
    } catch {
      continue;
    }
    const matches = collectMatches(contents);
    for (const match of matches) {
      seen.add(match);
      if (!declared.has(match)) {
        unknown.push({ key: match, file });
      }
    }
  }

  const dead: string[] = [];
  for (const key of declared) {
    if (!seen.has(key)) dead.push(key);
  }
  return { dead, unknown };
}

function collectMatches(source: string): string[] {
  const out = new Set<string>();
  for (const re of [FLAG_CALL_PATTERN, USE_FLAG_PATTERN]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const captured = match[1];
      if (captured !== undefined) out.add(captured);
    }
  }
  return Array.from(out);
}
