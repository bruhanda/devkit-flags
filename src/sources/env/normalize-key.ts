/**
 * Translate a camelCase / kebab-case flag key to its SCREAMING_SNAKE
 * env-var convention. Consecutive uppercase letters stay together
 * (`URLBase` → `URL_BASE`, not `U_R_L_BASE`).
 *
 * @param flagKey  The flag key as declared in the schema.
 * @returns        The env-var stem (without prefix).
 *
 * @example
 *   normalizeFlagKey('newCheckout')   // -> 'NEW_CHECKOUT'
 *   normalizeFlagKey('experimental-A') // -> 'EXPERIMENTAL_A'
 *   normalizeFlagKey('URLBase')        // -> 'URL_BASE'
 */
export function normalizeFlagKey(flagKey: string): string {
  return flagKey
    .replace(/-/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}
