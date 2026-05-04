import { deepFreeze } from '../../utils/freeze.js';
import type { FlagSchema } from '../../types/flag-schema.js';
import type { FlagSource, FlagSourceSnapshot } from '../../types/source.js';

/**
 * Wrap an in-code schema as a synchronous `FlagSource`. Always present
 * at the bottom of the source stack (`defineFlags` injects it
 * implicitly); the function is re-exported from the root entrypoint
 * so consumers building the handle dynamically can compose around it.
 *
 * @param schema  The schema to expose as a source.
 * @returns       A `FlagSource` whose `load()` resolves immediately.
 *
 * @example
 *   import { defaultsSource, createFlags } from '@devkit/flags';
 *   createFlags({ flags: schema, sources: [defaultsSource(schema)] });
 */
export function defaultsSource(schema: FlagSchema): FlagSource {
  const snapshot: FlagSourceSnapshot = deepFreeze({
    flags: schema,
    origin: 'defaults' as const,
    fetchedAt: Date.now(),
  });
  return {
    id: 'defaults',
    load: () => Promise.resolve(snapshot),
    snapshot: () => snapshot,
    subscribe: () => () => {},
  };
}
