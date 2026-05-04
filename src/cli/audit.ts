import { FlagsError } from '../errors/base.js';
import { parseFlagsJson } from '../sources/json/parse.js';
import { detectRuntime } from '../utils/runtime.js';

interface AuditOptions {
  readonly flagsJsonPath: string;
}

/**
 * Per-flag audit row — name, kind, deprecation status, optional
 * description and a best-effort `lastTouched` git timestamp pulled
 * from `git log -1 --format=%cI -- <file>` when the consumer's
 * environment exposes `git`. `lastTouched` is omitted when git is
 * unavailable, the file is untracked, or `git` exits non-zero.
 */
export interface AuditEntry {
  readonly key: string;
  readonly kind: string;
  readonly default: unknown;
  readonly deprecated: boolean;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly lastTouched?: string;
}

interface AuditReport {
  readonly file: string;
  readonly count: number;
  readonly deprecatedCount: number;
  readonly entries: readonly AuditEntry[];
}

/**
 * Emit a JSON-serialisable audit of every flag in `flags.json`. The
 * caller renders it as text or JSON depending on `--json`.
 *
 * @param opts  Input path.
 * @returns     A populated audit report.
 *
 * @example
 *   const report = await runAudit({ flagsJsonPath: 'flags.json' });
 *   console.log(JSON.stringify(report, null, 2));
 */
export async function runAudit(opts: AuditOptions): Promise<AuditReport> {
  const runtime = detectRuntime();
  if (runtime !== 'node' && runtime !== 'bun') {
    throw new FlagsError('INVALID_RUNTIME_OPTION', 'audit requires Node.js or Bun');
  }
  const fs = await import('node:fs/promises');
  const raw = await fs.readFile(opts.flagsJsonPath, { encoding: 'utf8' });
  const parsed = parseFlagsJson(raw);
  // The whole report shares one `lastTouched` value for now: declarations
  // live alongside each other in `flags.json`, so the file's last-commit
  // timestamp is the closest signal we can give without per-key blame.
  const lastTouched = await readGitLastTouched(opts.flagsJsonPath);
  const entries: AuditEntry[] = [];
  let deprecatedCount = 0;
  for (const [key, spec] of Object.entries(parsed.flags)) {
    const deprecated = spec.deprecated === true;
    if (deprecated) deprecatedCount += 1;
    entries.push({
      key,
      kind: spec.kind,
      default: spec.default,
      deprecated,
      ...(spec.description !== undefined ? { description: spec.description } : {}),
      ...(spec.tags !== undefined ? { tags: spec.tags } : {}),
      ...(lastTouched !== undefined ? { lastTouched } : {}),
    });
  }
  return {
    file: opts.flagsJsonPath,
    count: entries.length,
    deprecatedCount,
    entries,
  };
}

async function readGitLastTouched(filePath: string): Promise<string | undefined> {
  try {
    const { spawn } = await import('node:child_process');
    return await new Promise<string | undefined>((resolve) => {
      const child = spawn('git', ['log', '-1', '--format=%cI', '--', filePath], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.on('error', () => resolve(undefined));
      child.on('close', (code) => {
        if (code !== 0) {
          resolve(undefined);
          return;
        }
        const trimmed = stdout.trim();
        resolve(trimmed.length > 0 ? trimmed : undefined);
      });
    });
  } catch {
    return undefined;
  }
}
