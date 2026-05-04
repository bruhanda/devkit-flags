import { FlagsError } from '../errors/base.js';
import { deepFreeze } from '../utils/freeze.js';
import { once } from '../utils/once.js';
import { defaultsSource } from '../sources/defaults/index.js';
import type {
  CreateFlagsConfig,
  EvaluationContext,
  EvaluationEvent,
  EvaluationResult,
  FlagsHandle,
  FlagsHandleConfig,
  FlagsListener,
  FlagSchema,
  FlagSource,
  FlagSourceSnapshot,
} from '../types/index.js';
import type { FlagSpec } from '../types/flag-spec.js';
import type { RuleGroup } from '../types/rules.js';
import { evaluateFlag } from './evaluate.js';
import { resolveEnvironment } from './env.js';
import { dispatchEvaluation, redactSubject } from './observe.js';
import {
  composeSnapshots,
  toPublicSnapshot,
  type MergedSnapshot,
} from './snapshot.js';
import { validateSchema } from './validate.js';

/**
 * Lower-level factory used internally by `defineFlags`. Reach for it
 * when the schema is NOT a TS literal — for example, when you load
 * the schema from a JSON file at runtime or generate it from a CMS.
 *
 * The returned handle is structurally identical to `defineFlags`'s,
 * but `get()` is typed `(key: string, ctx?) => unknown` — you lose
 * the per-key narrowing. Pair it with `flags codegen` (CLI) for the
 * best of both worlds.
 *
 * @param config  Runtime configuration — flags, sources, environment,
 *                hooks. The schema is validated synchronously; bad
 *                shapes throw `FlagsError('INVALID_SCHEMA')`.
 * @returns       A frozen `FlagsHandle`.
 * @throws        `FlagsError('INVALID_SCHEMA')` on invalid schema.
 *
 * @example
 *   const schema: FlagSchema = await loadFromCms();
 *   const flags = createFlags({ flags: schema });
 *   const value = flags.get('checkoutVariant');
 */
export function createFlags(config: CreateFlagsConfig): FlagsHandle {
  validateSchema(config.flags);

  const baseEnvironment = resolveEnvironment(config.environment);
  const salt = config.salt ?? '';
  const sources: FlagSource[] = [
    defaultsSource(config.flags),
    ...(config.sources ?? []),
  ];
  for (const source of sources) {
    source.bindSchema?.(config.flags);
  }
  const segmentsConfig: Readonly<Record<string, RuleGroup>> = config.segments ?? {};
  const listeners = new Set<FlagsListener>();
  const subscriptions: (() => void)[] = [];
  let disposed = false;
  let readyResolved = sources.every((s) => s.snapshot() !== undefined);
  let initialised = false;
  // Bumped on every snapshot swap. Adapters key derived projections
  // (`useFlags`, `useFlagResult`) on this so React's `Object.is` check
  // sees a stable reference until the snapshot actually changes.
  let snapshotVersion = 0;

  let merged = makeMerged();

  const initialise = once(async () => {
    const snapshots = await Promise.all(sources.map((s) => s.load()));
    merged = composeSnapshots(snapshots);
    readyResolved = true;
    initialised = true;
    snapshotVersion += 1;
    invalidateProjectionCaches();
    fanout();
    return merged;
  });

  for (const source of sources) {
    subscriptions.push(
      source.subscribe(() => {
        // Drop fan-out from synchronous source callbacks fired during
        // the first `Promise.all(sources.map(s => s.load()))` —
        // `initialise` will assign the post-load `merged` itself.
        if (!initialised) return;
        rebuild();
      }),
    );
  }

  const normalisedConfig: FlagsHandleConfig = deepFreeze({
    flags: config.flags,
    environment: baseEnvironment,
    salt,
    segments: segmentsConfig,
    ...(config.subjectId !== undefined ? { subjectId: config.subjectId } : {}),
    ...(config.onEvaluation !== undefined ? { onEvaluation: config.onEvaluation } : {}),
    ...(config.redactSubject !== undefined ? { redactSubject: config.redactSubject } : {}),
    sources,
  });

  function makeMerged(): MergedSnapshot {
    let next = composeSnapshots(
      sources
        .map((s) => s.snapshot())
        .filter((s): s is FlagSourceSnapshot => s !== undefined),
    );
    if (!readyResolved) next = withStale(next, true);
    return next;
  }

  function rebuild(): void {
    merged = makeMerged();
    snapshotVersion += 1;
    invalidateProjectionCaches();
    fanout();
  }

  // Per-(version, contextRef) projection caches. `useSyncExternalStore`
  // (and the SvelteKit / Vue equivalents) call `getSnapshot()` on every
  // render and compare with `Object.is`; without this, every render
  // sees a fresh frozen object and either tears or infinite-loops.
  let lastGetAll:
    | { ctx: EvaluationContext | undefined; version: number; result: unknown }
    | undefined;
  const lastGetDetail = new Map<
    string,
    { ctx: EvaluationContext | undefined; version: number; result: EvaluationResult }
  >();

  function invalidateProjectionCaches(): void {
    lastGetAll = undefined;
    lastGetDetail.clear();
  }

  function fanout(): void {
    const publicSnapshot = toPublicSnapshot(merged);
    for (const listener of listeners) {
      try {
        listener(publicSnapshot);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[devkit/flags] listener threw:', err);
      }
    }
  }

  function evaluate(
    key: string,
    context: EvaluationContext | undefined,
    callDefault: unknown,
    callDefaultPresent: boolean,
  ): EvaluationResult {
    const ctx: EvaluationContext = context ?? {};
    const env = resolveEnvironment(baseEnvironment, ctx.environment);
    const spec: FlagSpec | undefined = merged.flags[key];

    if (spec === undefined) {
      const fallback = callDefaultPresent ? callDefault : undefined;
      const result: EvaluationResult = {
        key,
        value: fallback,
        reason: 'ERROR',
        source: 'defaults',
        stale: merged.stale,
      };
      emit(result, ctx, env, 'UNKNOWN_FLAG', `unknown flag "${key}"`);
      return result;
    }

    const callOverride = ctx.overrides?.[key as never];
    const exposureFired = new Set<string>();
    let ruleError: { code: string; message: string } | undefined;

    let result = evaluateFlag({
      key,
      spec,
      context: ctx,
      environment: env,
      salt,
      source: merged.sourceMap[key] ?? 'defaults',
      stale: merged.stale,
      segments: { ...segmentsConfig, ...merged.segments },
      ...(config.subjectId !== undefined ? { defaultSubjectId: config.subjectId } : {}),
      ...(callOverride !== undefined ? { callOverride } : {}),
      reportRuleError: (info) => {
        const message =
          info.kind === 'segment-cycle'
            ? `cycle detected resolving $segment "${info.name}"`
            : `matcher "${info.name}" threw: ${
                info.cause instanceof Error ? info.cause.message : String(info.cause)
              }`;
        ruleError = { code: 'RULE_EVAL_ERROR', message };
      },
      recordExposure: (flagKey, ruleId) => {
        const tag = `${flagKey}::${ruleId ?? ''}`;
        if (exposureFired.has(tag)) return;
        exposureFired.add(tag);
        const subjectField = buildSubjectField(ctx);
        const event: EvaluationEvent = {
          flagKey,
          value: undefined,
          reason: 'TARGETING_MATCH',
          environment: env,
          elapsedMs: 0,
          timestamp: Date.now(),
          ...(ruleId !== undefined ? { ruleId } : {}),
          ...(subjectField.subject !== undefined
            ? { subject: subjectField.subject }
            : {}),
        };
        dispatchEvaluation(config.onEvaluation, event);
      },
    });

    // Stale snapshot AND a static fallback was returned — surface the
    // documented `STALE` reason so callers can render a Suspense /
    // fallback branch (per §9.25).
    if (
      result.stale &&
      (result.reason === 'STATIC' || result.reason === 'TARGETING_FALLBACK')
    ) {
      result = { ...result, reason: 'STALE' };
    }

    if (result.reason === 'ERROR' && callDefaultPresent) {
      result = { ...result, value: callDefault };
    }

    if (ruleError !== undefined) {
      emit(result, ctx, env, ruleError.code, ruleError.message);
    } else {
      emit(result, ctx, env);
    }
    return result;
  }

  function emit(
    result: EvaluationResult,
    context: EvaluationContext,
    env: string,
    errorCode?: string,
    errorMessage?: string,
  ): void {
    const subjectField = buildSubjectField(context);
    const event: EvaluationEvent = {
      flagKey: result.key,
      value: result.value,
      reason: result.reason,
      environment: env,
      elapsedMs: 0,
      timestamp: Date.now(),
      ...(result.ruleId !== undefined ? { ruleId: result.ruleId } : {}),
      ...(result.bucket !== undefined ? { bucket: result.bucket } : {}),
      ...(subjectField.subject !== undefined
        ? { subject: subjectField.subject }
        : {}),
      ...(errorCode !== undefined && errorMessage !== undefined
        ? { error: { code: errorCode, message: errorMessage } }
        : {}),
    };
    dispatchEvaluation(config.onEvaluation, event);
  }

  function buildSubjectField(
    context: EvaluationContext,
  ): { subject?: NonNullable<EvaluationEvent['subject']> } {
    const subject = redactSubject(context.subject, config.redactSubject);
    return subject !== undefined ? { subject } : {};
  }

  const handle: FlagsHandle = {
    get(key: string, context?: EvaluationContext, defaultValue?: unknown) {
      const present = arguments.length >= 3;
      const result = evaluate(key, context, defaultValue, present);
      return result.value as never;
    },
    async getAsync(key: string, context?: EvaluationContext, defaultValue?: unknown) {
      await initialise();
      const present = arguments.length >= 3;
      const result = evaluate(key, context, defaultValue, present);
      return result.value as never;
    },
    getAll(context?: EvaluationContext) {
      if (
        lastGetAll !== undefined &&
        lastGetAll.ctx === context &&
        lastGetAll.version === snapshotVersion
      ) {
        return lastGetAll.result as never;
      }
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(merged.flags)) {
        const result = evaluate(key, context, undefined, false);
        out[key] = result.value;
      }
      const frozen = deepFreeze(out);
      lastGetAll = { ctx: context, version: snapshotVersion, result: frozen };
      return frozen as never;
    },
    async getAllAsync(context?: EvaluationContext) {
      await initialise();
      return handle.getAll(context);
    },
    getDetail(key: string, context?: EvaluationContext) {
      const cached = lastGetDetail.get(key);
      if (
        cached !== undefined &&
        cached.ctx === context &&
        cached.version === snapshotVersion
      ) {
        return cached.result as never;
      }
      const result = evaluate(key, context, undefined, false);
      lastGetDetail.set(key, { ctx: context, version: snapshotVersion, result });
      return result as never;
    },
    async getDetailAsync(key: string, context?: EvaluationContext) {
      await initialise();
      return handle.getDetail(key as never, context as never);
    },
    async ready() {
      await initialise();
    },
    subscribe(listener: FlagsListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async reload() {
      if (disposed) {
        throw new FlagsError('SOURCE_REFRESH_FAILED', 'handle disposed');
      }
      const snapshots = await Promise.all(
        sources.map((s) => (s.reload !== undefined ? s.reload() : s.load())),
      );
      merged = composeSnapshots(snapshots);
      readyResolved = true;
      initialised = true;
      snapshotVersion += 1;
      invalidateProjectionCaches();
      fanout();
      return toPublicSnapshot(merged);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsub of subscriptions) {
        try {
          unsub();
        } catch {
          // ignore
        }
      }
      subscriptions.length = 0;
      listeners.clear();
      for (const source of sources) {
        if (source.close !== undefined) {
          try {
            await source.close();
          } catch {
            // ignore
          }
        }
      }
    },
    version() {
      return snapshotVersion;
    },
    config: normalisedConfig as Readonly<FlagsHandleConfig<FlagSchema>>,
    snapshot() {
      return toPublicSnapshot(merged);
    },
  };

  return Object.freeze(handle);
}

function withStale(merged: MergedSnapshot, stale: boolean): MergedSnapshot {
  if (merged.stale === stale) return merged;
  return deepFreeze({ ...merged, stale });
}
