/**
 * Finite, stable list of error codes emitted by the library. Adding a
 * code is a minor-version change; renaming or removing one is breaking.
 */
export const FLAGS_ERROR_CODES = [
  'INVALID_SCHEMA',
  'INVALID_RUNTIME_OPTION',
  'UNKNOWN_FLAG',
  'JSON_PARSE_ERROR',
  'UNSAFE_MATCHER_FROM_JSON',
  'JSON_SCHEMA_ERROR',
  'TYPE_MISMATCH',
  'SOURCE_LOAD_FAILED',
  'SOURCE_REFRESH_FAILED',
  'PAYLOAD_TOO_LARGE',
  'OBSERVABILITY_HOOK_ERROR',
  'RULE_EVAL_ERROR',
  'REGEX_TIMEOUT',
  'REGEX_DISABLED',
  'STALE_READ',
] as const;

/** String-union of every supported error code. */
export type FlagsErrorCode = (typeof FLAGS_ERROR_CODES)[number];
