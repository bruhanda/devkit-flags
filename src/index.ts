/**
 * Root entrypoint of `@devkit/flags`. Re-exports the public API.
 *
 * Subpath imports (`@devkit/flags/sources/json`, `/adapters/react`,
 * etc.) live under their own entry points and never flow through here
 * — keeping the core bundle ≤ 3 KB gzipped.
 */

export { defineFlags } from './core/define.js';
export { createFlags } from './core/flags.js';
export { defaultsSource } from './sources/defaults/index.js';
export { composeSources } from './sources/compose/index.js';

export { FlagsError } from './errors/index.js';
export type { FlagsErrorCode } from './errors/index.js';

export type {
  // Configuration
  DefineFlagsConfig,
  CreateFlagsConfig,
  AttributeSchema,
  AttributesOf,
  // Handle
  FlagsHandle,
  FlagsHandleConfig,
  FlagsListener,
  // Schema + flag specs
  FlagSchema,
  FlagSpec,
  BooleanFlagSpec,
  StringFlagSpec,
  NumberFlagSpec,
  JsonFlagSpec,
  StandardSchemaV1,
  FlagKind,
  FlagValueOf,
  FlagKeysOf,
  FlagValuesOf,
  // Context
  EvaluationContext,
  Subject,
  // Rules
  Rule,
  RuleGroup,
  Rollout,
  Matcher,
  Operator,
  SegmentName,
  // Result
  EvaluationResult,
  EvaluationReason,
  EvaluationSource,
  // Sources
  FlagSource,
  FlagSourceSnapshot,
  FlagSourceSubscribeOptions,
  // Observability
  OnEvaluation,
  EvaluationEvent,
  RedactSubject,
  // Misc
  Environment,
  Json,
  Jsonable,
} from './types/index.js';
