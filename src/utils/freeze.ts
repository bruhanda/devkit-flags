/**
 * Recursively `Object.freeze` an object graph, stopping at primitives,
 * functions, and already-frozen nodes. Used to make every public
 * snapshot and `FlagsHandle.config` field immutable for callers.
 *
 * @typeParam T  The value to freeze.
 * @param value  The value to freeze in place.
 * @returns The input, narrowed to `Readonly<T>`.
 *
 * @example
 *   const snapshot = deepFreeze({ flags: { ... } });
 *   snapshot.flags.x = ...; // TypeError at runtime
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== null && (typeof child === 'object' || typeof child === 'function')) {
      deepFreeze(child);
    }
  }
  return value;
}
