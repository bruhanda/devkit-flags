const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32-bit hash. Deterministic across every supported runtime,
 * stable across releases, and inlined by `tsup` at minify time.
 *
 * Used to compute consistent-hash buckets for percentage rollouts.
 *
 * @param input  String to hash.
 * @returns      Unsigned 32-bit integer hash.
 *
 * @example
 *   const bucket = fnv1a32('salt:newCheckout:user_42') % 10_000;
 */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}
