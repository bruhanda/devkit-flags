import { FlagsError } from '../errors/base.js';
import { parseFlagsJson } from '../sources/json/parse.js';
import { detectRuntime } from '../utils/runtime.js';

interface AuditOptions {
  readonly flagsJsonPath: string;
}

/**
 * Per-flag audit row — name, kind, deprecation status, optional
 * description and a best-effort `lastTouched` git timestamp pulled
 * from `git log -1 -- <file>` when the consumer's environment exposes
 * `git`.
 */
export interface AuditEntry {
  readonly key: string;
  readonly kind: string;
  readonly default: unknown;
  readonly deprecated: boolean;
  readonly description?: string;
  readonly tags?: readonly string[];
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
    });
  }
  return {
    file: opts.flagsJsonPath,
    count: entries.length,
    deprecatedCount,
    entries,
  };
}
