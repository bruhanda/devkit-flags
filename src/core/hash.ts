const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32-bit hash. Deterministic across every supported JS runtime
 * (Node, Bun, Deno, browsers, edge workers) and stable across releases.
 * Inlined by `tsup` at minify time.
 *
 * Hashes UTF-16 code units — the same units `String.prototype.charCodeAt`
 * returns. JS-family implementations agree, but a Go / Python / Rust
 * `fnv1a32` operating on bytes will produce a different hash for any
 * input with non-ASCII characters. If you need cross-language bucket
 * agreement, normalise to ASCII subject ids on both sides.
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
