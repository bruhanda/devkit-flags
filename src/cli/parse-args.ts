/**
 * Parsed CLI arguments — `_` carries positional args, every other key
 * is a long-form flag (`--in foo` → `{ in: 'foo' }`). Boolean flags
 * (`--json`, no value) resolve to `true`.
 */
export interface ParsedArgs {
  readonly _: readonly string[];
  readonly [key: string]: unknown;
}

/**
 * Vendored 50-LOC argument parser. Keeps the CLI bundle dep-free —
 * commander / yargs would weigh more than the rest of the package.
 *
 * Supported syntax:
 *   `--key value`    → `{ key: 'value' }`
 *   `--key=value`    → `{ key: 'value' }`
 *   `--key`          → `{ key: true }`
 *   `--no-key`       → `{ key: false }`
 *   anything else    → positional, into `_`
 *
 * @param argv  Argument list (`process.argv.slice(2)`).
 * @returns     Parsed `{ _: [...], key: value }` shape.
 *
 * @example
 *   parseArgs(['lint', '--in', 'flags.json', '--json'])
 *   // -> { _: ['lint'], in: 'flags.json', json: true }
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const out: Record<string, unknown> = { _: positional };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      const key = token.slice(2, eq);
      out[key] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    if (key.startsWith('no-')) {
      out[key.slice(3)] = false;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  out['_'] = positional;
  return out as ParsedArgs;
}
