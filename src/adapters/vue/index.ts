import { inject, ref, onScopeDispose, type App, type Ref } from 'vue';
import type {
  EvaluationContext,
  FlagSchema,
  FlagKeysOf,
  FlagValueOf,
  FlagsHandle,
} from '../../types/index.js';
import type { AttributeSchema } from '../../types/rules.js';

const INJECTION_KEY = Symbol.for('devkit/flags.handle');

interface PluginOptions<S extends FlagSchema, A extends AttributeSchema> {
  readonly context?: EvaluationContext<A, S>;
}

/**
 * Vue plugin factory. Registers the supplied handle under a stable
 * injection key so descendants can pull it via `useFlag`.
 *
 * @param flags  The configured `FlagsHandle`.
 * @param opts   Optional default `EvaluationContext`.
 * @returns      A Vue `Plugin`.
 *
 * @example
 *   import { createApp } from 'vue';
 *   import { flags } from './flags';
 *   import { createFlagsPlugin } from '@devkit/flags/adapters/vue';
 *
 *   createApp(App).use(createFlagsPlugin(flags)).mount('#app');
 */
export function createFlagsPlugin<
  S extends FlagSchema,
  A extends AttributeSchema = AttributeSchema,
>(flags: FlagsHandle<S, A>, opts?: PluginOptions<S, A>) {
  return {
    install(app: App): void {
      app.provide(INJECTION_KEY, { handle: flags, evaluation: opts?.context });
    },
  };
}

/**
 * Vue composable — reactive `Ref` to a single flag's value. Re-runs
 * on every snapshot swap; cleans up the subscription on scope dispose.
 *
 * @param key  Flag key.
 * @returns    `Ref<FlagValueOf<S, K>>` whose `.value` always tracks
 *             the current snapshot.
 *
 * @example
 *   const enabled = useFlag<typeof flags extends FlagsHandle<infer S> ? S : never, 'newCheckout'>('newCheckout');
 */
export function useFlag<
  S extends FlagSchema,
  K extends FlagKeysOf<S>,
  A extends AttributeSchema = AttributeSchema,
>(key: K): Ref<FlagValueOf<S, K>> {
  const provided = inject<{
    handle: FlagsHandle<S, A>;
    evaluation?: EvaluationContext<A, S>;
  }>(INJECTION_KEY);
  if (provided === undefined) {
    throw new Error(
      '[devkit/flags] useFlag requires app.use(createFlagsPlugin(flags))',
    );
  }
  const initial = provided.handle.get(key, provided.evaluation as never);
  const valueRef = ref(initial) as Ref<FlagValueOf<S, K>>;
  const unsubscribe = provided.handle.subscribe(() => {
    valueRef.value = provided.handle.get(key, provided.evaluation as never);
  });
  onScopeDispose(() => {
    unsubscribe();
  });
  return valueRef;
}
