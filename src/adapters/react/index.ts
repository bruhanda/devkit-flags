import {
  Fragment,
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { EvaluationContext } from '../../types/context.js';
import type {
  FlagSchema,
  FlagKeysOf,
  FlagValueOf,
  FlagValuesOf,
} from '../../types/flag-schema.js';
import type { FlagsHandle } from '../../types/flags.js';
import type { EvaluationResult } from '../../types/result.js';
import type { AttributeSchema } from '../../types/rules.js';
import type { FlagSourceSnapshot } from '../../types/source.js';

interface ContextValue<S extends FlagSchema, A extends AttributeSchema> {
  readonly handle: FlagsHandle<S, A>;
  readonly evaluation?: EvaluationContext<A, S>;
  /**
   * SSR hydration snapshot. Used as the `getServerSnapshot` return for
   * `useSyncExternalStore` so the server-rendered HTML and the first
   * client read agree before the client-side handle finishes loading.
   */
  readonly initialSnapshot?: FlagSourceSnapshot;
}

const FlagsContext = createContext<ContextValue<FlagSchema, AttributeSchema> | null>(
  null,
);
FlagsContext.displayName = 'devkit/flags.Context';

interface ProviderProps<S extends FlagSchema, A extends AttributeSchema> {
  readonly flags: FlagsHandle<S, A>;
  readonly context?: EvaluationContext<A, S>;
  readonly initialSnapshot?: FlagSourceSnapshot;
  readonly children: ReactNode;
}

/**
 * Generic `FlagsProvider`. Stash the handle in React context so every
 * descendant `useFlag*` hook can subscribe to source updates via
 * `useSyncExternalStore`.
 *
 * Most consumers prefer `createReactBindings(flags)` over the
 * stringly-typed surface — the bindings factory pre-narrows every
 * hook against the handle's `TSchema` / `TAttrs` generics.
 */
export function FlagsProvider<S extends FlagSchema, A extends AttributeSchema>(
  props: ProviderProps<S, A>,
): JSX.Element {
  const value = useMemo<ContextValue<S, A>>(
    () => ({
      handle: props.flags,
      ...(props.context !== undefined ? { evaluation: props.context } : {}),
      ...(props.initialSnapshot !== undefined
        ? { initialSnapshot: props.initialSnapshot }
        : {}),
    }),
    [props.flags, props.context, props.initialSnapshot],
  );
  return createElement(
    FlagsContext.Provider,
    { value: value as ContextValue<FlagSchema, AttributeSchema> },
    props.children,
  );
}

function useHandleContext<S extends FlagSchema, A extends AttributeSchema>(): ContextValue<
  S,
  A
> {
  const ctx = useContext(FlagsContext);
  if (ctx === null) {
    throw new Error(
      '[devkit/flags] useFlag* must be called inside a <FlagsProvider> tree',
    );
  }
  return ctx as ContextValue<S, A>;
}

/**
 * Subscribe to a single flag's value. Concurrent-mode safe via
 * `useSyncExternalStore`. Re-renders when the snapshot swaps OR when
 * the surrounding `EvaluationContext` changes.
 *
 * Snapshot identity is stabilised by the handle itself (`getAll` /
 * `getDetail` cache the result per `(version, contextRef)`), so this
 * adapter does not need a wrapper memo to avoid `useSyncExternalStore`
 * tearing.
 */
export function useFlag<S extends FlagSchema, K extends FlagKeysOf<S>>(
  key: K,
  fallback?: FlagValueOf<S, K>,
): FlagValueOf<S, K> {
  const ctx = useHandleContext<S, AttributeSchema>();
  const subscribe = useCallback(
    (notify: () => void) => ctx.handle.subscribe(notify),
    [ctx.handle],
  );
  const getSnapshot = useCallback(() => {
    return fallback !== undefined
      ? ctx.handle.get(key, ctx.evaluation as never, fallback as never)
      : ctx.handle.get(key, ctx.evaluation as never);
  }, [ctx.handle, ctx.evaluation, key, fallback]);
  const getServerSnapshot = useCallback(() => {
    if (ctx.initialSnapshot !== undefined) {
      const spec = ctx.initialSnapshot.flags[key as string];
      if (spec !== undefined) return spec.default as FlagValueOf<S, K>;
    }
    return fallback !== undefined
      ? (fallback as FlagValueOf<S, K>)
      : (undefined as unknown as FlagValueOf<S, K>);
  }, [ctx.initialSnapshot, key, fallback]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Read full evaluation result (reason / bucket / ruleId). */
export function useFlagResult<S extends FlagSchema, K extends FlagKeysOf<S>>(
  key: K,
): EvaluationResult<FlagValueOf<S, K>> {
  const ctx = useHandleContext<S, AttributeSchema>();
  const subscribe = useCallback(
    (notify: () => void) => ctx.handle.subscribe(notify),
    [ctx.handle],
  );
  const getSnapshot = useCallback(
    () => ctx.handle.getDetail(key, ctx.evaluation as never),
    [ctx.handle, ctx.evaluation, key],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Read every flag at once. Re-renders on any flip. */
export function useFlags<S extends FlagSchema>(): FlagValuesOf<S> {
  const ctx = useHandleContext<S, AttributeSchema>();
  const subscribe = useCallback(
    (notify: () => void) => ctx.handle.subscribe(notify),
    [ctx.handle],
  );
  const getSnapshot = useCallback(
    () => ctx.handle.getAll(ctx.evaluation as never) as FlagValuesOf<S>,
    [ctx.handle, ctx.evaluation],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Render-prop / declarative form. */
export function Flag<S extends FlagSchema, K extends FlagKeysOf<S>>(props: {
  name: K;
  children: FlagValueOf<S, K> | ((value: FlagValueOf<S, K>) => ReactNode);
  fallback?: ReactNode;
}): JSX.Element {
  const value = useFlag<S, K>(props.name);
  if (value === undefined || value === null || value === false) {
    return createElement(Fragment, null, props.fallback ?? null);
  }
  if (typeof props.children === 'function') {
    return createElement(
      Fragment,
      null,
      (props.children as (v: FlagValueOf<S, K>) => ReactNode)(value),
    );
  }
  return createElement(Fragment, null, props.children as ReactNode);
}

/**
 * Bindings factory. Returns React primitives bound to the supplied
 * handle's generics — every hook narrows `key` against
 * `FlagKeysOf<S>` and the return value against `FlagValueOf<S, K>`
 * with zero ambient-module tax.
 *
 * @example
 *   export const { FlagsProvider, useFlag, useFlagResult, useFlags, Flag } =
 *     createReactBindings(flags);
 */
export function createReactBindings<
  S extends FlagSchema,
  A extends AttributeSchema,
>(handle: FlagsHandle<S, A>): {
  FlagsProvider: (props: {
    context?: EvaluationContext<A, S>;
    initialSnapshot?: FlagSourceSnapshot;
    children: ReactNode;
  }) => JSX.Element;
  useFlag: <K extends FlagKeysOf<S>>(
    key: K,
    fallback?: FlagValueOf<S, K>,
  ) => FlagValueOf<S, K>;
  useFlagResult: <K extends FlagKeysOf<S>>(
    key: K,
  ) => EvaluationResult<FlagValueOf<S, K>>;
  useFlags: () => FlagValuesOf<S>;
  Flag: <K extends FlagKeysOf<S>>(props: {
    name: K;
    children: FlagValueOf<S, K> | ((value: FlagValueOf<S, K>) => ReactNode);
    fallback?: ReactNode;
  }) => JSX.Element;
} {
  function BoundProvider(props: {
    context?: EvaluationContext<A, S>;
    initialSnapshot?: FlagSourceSnapshot;
    children: ReactNode;
  }): JSX.Element {
    return createElement(
      FlagsProvider as (p: ProviderProps<S, A>) => JSX.Element,
      {
        flags: handle,
        ...(props.context !== undefined ? { context: props.context } : {}),
        ...(props.initialSnapshot !== undefined
          ? { initialSnapshot: props.initialSnapshot }
          : {}),
        children: props.children,
      },
    );
  }
  return {
    FlagsProvider: BoundProvider,
    useFlag: <K extends FlagKeysOf<S>>(key: K, fallback?: FlagValueOf<S, K>) =>
      useFlag<S, K>(key, fallback),
    useFlagResult: <K extends FlagKeysOf<S>>(key: K) => useFlagResult<S, K>(key),
    useFlags: () => useFlags<S>(),
    Flag: <K extends FlagKeysOf<S>>(props: {
      name: K;
      children: FlagValueOf<S, K> | ((value: FlagValueOf<S, K>) => ReactNode);
      fallback?: ReactNode;
    }) => Flag<S, K>(props),
  };
}
