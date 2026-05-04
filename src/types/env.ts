/**
 * Active deployment environment string. The runtime treats it as
 * an opaque key into a flag's `environments` map; consumers commonly
 * use `'production'`, `'staging'`, `'dev'`, but any string is valid.
 */
export type Environment = string;
