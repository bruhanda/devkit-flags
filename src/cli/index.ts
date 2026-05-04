#!/usr/bin/env node
import { FlagsError } from '../errors/base.js';
import { runAudit } from './audit.js';
import { runCodegen } from './codegen.js';
import { runLint } from './lint.js';
import { parseArgs } from './parse-args.js';

const HELP = `flags — devkit-flags CLI

Usage:
  flags codegen  --in <flags.json> --out <out.ts>
  flags lint     --in <flags.json> --src <src-root> [--json]
  flags audit    --in <flags.json> [--json]

Subcommands:
  codegen   Generate a typed defineFlags<{...}>() module from flags.json.
  lint      Report dead flags + unknown keys read in source code.
  audit     Emit a structured report of every declared flag.
`;

/**
 * Entry point used by the `flags` bin in `package.json`.
 *
 * @returns  Exit code (0 on success, non-zero on failure).
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const command = args._[0];
  if (command === undefined || command === 'help' || args['help'] === true) {
    process.stdout.write(HELP);
    return 0;
  }
  try {
    switch (command) {
      case 'codegen': {
        const inPath = stringArg(args, 'in');
        const outPath = stringArg(args, 'out');
        await runCodegen({ inPath, outPath });
        process.stdout.write(`✓ wrote ${outPath}\n`);
        return 0;
      }
      case 'lint': {
        const flagsJsonPath = stringArg(args, 'in');
        const srcRoot = stringArg(args, 'src');
        const report = await runLint({ flagsJsonPath, srcRoot });
        if (args['json'] === true) {
          process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        } else {
          if (report.dead.length === 0 && report.unknown.length === 0) {
            process.stdout.write('✓ no issues found\n');
          } else {
            if (report.dead.length > 0) {
              process.stdout.write(`Dead flags (${report.dead.length}):\n`);
              for (const key of report.dead) process.stdout.write(`  - ${key}\n`);
            }
            if (report.unknown.length > 0) {
              process.stdout.write(`Unknown keys (${report.unknown.length}):\n`);
              for (const { key, file } of report.unknown) {
                process.stdout.write(`  - ${key}  ${file}\n`);
              }
            }
          }
        }
        return report.dead.length > 0 || report.unknown.length > 0 ? 1 : 0;
      }
      case 'audit': {
        const flagsJsonPath = stringArg(args, 'in');
        const report = await runAudit({ flagsJsonPath });
        if (args['json'] === true) {
          process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        } else {
          process.stdout.write(
            `${report.file} — ${report.count} flag(s), ${report.deprecatedCount} deprecated\n`,
          );
          for (const entry of report.entries) {
            process.stdout.write(
              `  ${entry.deprecated ? '!' : ' '} ${entry.key} (${entry.kind})` +
                (entry.description !== undefined ? `  — ${entry.description}` : '') +
                '\n',
            );
          }
        }
        return 0;
      }
      default:
        process.stderr.write(`unknown command: ${command}\n${HELP}`);
        return 2;
    }
  } catch (err) {
    if (FlagsError.is(err)) {
      process.stderr.write(`flags: ${err.code}: ${err.message}\n`);
    } else if (err instanceof Error) {
      process.stderr.write(`flags: ${err.message}\n`);
    } else {
      process.stderr.write(`flags: unknown error: ${String(err)}\n`);
    }
    return 1;
  }
}

function stringArg(args: ReturnType<typeof parseArgs>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || value === '') {
    throw new FlagsError(
      'INVALID_RUNTIME_OPTION',
      `missing or empty --${name} argument`,
    );
  }
  return value;
}

if (
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  // Heuristic: invoked directly when the bin script imports this file
  process.argv[1].includes('cli')
) {
  void main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(
        `flags: fatal: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exitCode = 1;
    },
  );
}
