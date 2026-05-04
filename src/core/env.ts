import { readHostEnv } from '../utils/runtime.js';
import type { Environment } from '../types/env.js';

/**
 * Resolve the active environment. Order of precedence:
 *   1. explicit `override` argument (per-call `ctx.environment`)
 *   2. `config.environment` from `defineFlags`
 *   3. `NODE_ENV` (Node / Bun) or `Deno.env.get('NODE_ENV')` (Deno)
 *   4. `ENVIRONMENT`
 *   5. `'production'` fallback
 *
 * @param configured  The handle-level configured environment (if any).
 * @param override    Per-call override from `EvaluationContext.environment`.
 * @returns           The resolved environment string.
 *
 * @example
 *   const env = resolveEnvironment('staging'); // -> 'staging'
 *   const env = resolveEnvironment(undefined, 'preview'); // -> 'preview'
 */
export function resolveEnvironment(
  configured?: Environment,
  override?: Environment,
): Environment {
  if (override !== undefined && override !== '') return override;
  if (configured !== undefined && configured !== '') return configured;
  const env = readHostEnv();
  const nodeEnv = env['NODE_ENV'];
  if (typeof nodeEnv === 'string' && nodeEnv !== '') return nodeEnv;
  const environment = env['ENVIRONMENT'];
  if (typeof environment === 'string' && environment !== '') return environment;
  return 'production';
}
