/**
 * Memoise an async factory so concurrent first-readers share a single
 * in-flight promise. Subsequent calls — both during and after the
 * resolution — return the same `Promise` reference.
 *
 * Used by the handle's initial source-load coordinator.
 *
 * @typeParam T  Resolved value type.
 * @param factory  An async producer; called at most once.
 * @returns        A function that returns the cached `Promise<T>`.
 *
 * @example
 *   const loadOnce = once(() => fetchSnapshot());
 *   await Promise.all([loadOnce(), loadOnce()]); // single network call
 */
export function once<T>(factory: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (pending === undefined) {
      pending = factory();
    }
    return pending;
  };
}
