import type { FlagSpec } from './flag-spec.js';
import type { RuleGroup } from './rules.js';
import type { EvaluationSource } from './result.js';

/**
 * Frozen, in-memory image of a single source's contribution to the
 * merged snapshot. Reads run against a snapshot so an in-flight reload
 * never tears values mid-evaluation.
 */
export interface FlagSourceSnapshot {
  readonly flags: Readonly<Record<string, FlagSpec>>;
  readonly segments?: Readonly<Record<string, RuleGroup>>;
  readonly origin: EvaluationSource;
  readonly stale?: boolean;
  readonly fetchedAt?: number;
}

/** Subscribe-callback options — currently empty, reserved for v1.x. */
export interface FlagSourceSubscribeOptions {
  readonly signal?: AbortSignal;
}

/**
 * Pluggable source contract. Sources may load synchronously
 * (`defaultsSource`, in-line object JSON source) or asynchronously
 * (`createJsonSource('./flags.json')`, `createRemoteSource(url)`).
 *
 * `bindSchema` is the internal hook the handle calls during
 * construction so a source (e.g. `createEnvSource`) can consult the
 * declared schema for type-aware coercion + allowlist defaults
 * without the consumer wiring it manually.
 */
export interface FlagSource {
  readonly id: EvaluationSource;
  load(): Promise<FlagSourceSnapshot>;
  snapshot(): FlagSourceSnapshot | undefined;
  subscribe(
    listener: (snapshot: FlagSourceSnapshot) => void,
    opts?: FlagSourceSubscribeOptions,
  ): () => void;
  reload?(): Promise<FlagSourceSnapshot>;
  close?(): Promise<void> | void;
  bindSchema?(schema: Readonly<Record<string, import('./flag-spec.js').FlagSpec>>): void;
}
