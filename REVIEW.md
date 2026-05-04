# Response to Review by Mykhailo Kryvytskyi

Thanks for the thorough pass. Verdict from your end was REQUEST_CHANGES;
addressed every blocker and major below. Notes per item are
"agree → fix" or "disagree → reasoning".

## Blockers

### 1. `poll.ts` backoff path leaves source silent — agree, fixed

**Concern.** `IntervalDriver.start()` early-returns on `this.handle !==
undefined`. The failure path `stop()`s, then re-uses the same `handle`
field for the backoff `setTimeout` id, so the timeout fires but
`this.handle` still looks "alive" → `start()` short-circuits forever.

**Fix.** Split into `intervalHandle` / `backoffHandle`, clear the
backoff handle inside the timeout closure before re-arming. No more
"lying to TS" with the dual `clearInterval` + `clearTimeout`.

**Files.** `src/sources/remote/poll.ts`.

### 2. Segment recursion has no cycle protection — agree, fixed

**Concern.** `{ "$segment": "a" }` with a transitive self-reference
blows the stack on first eval.

**Fix.** Threaded an optional `inFlightSegments: Set<string>` plus an
optional `reportError` callback through `matchRule`. Re-entering a
segment reports `RULE_EVAL_ERROR` (kind: `segment-cycle`) and returns
`false`. Kept the legacy `(group, ctx, segments)` 3-arg call shape
working via an `isMatchOptions` discriminator so existing call sites
don't need to change.

**Files.** `src/core/rules.ts`, `src/core/evaluate.ts`,
`src/core/flags.ts`.

### 3. React `useFlags` / `useFlagResult` re-render every commit — agree, fixed

**Concern.** `getAll()` and `getDetail()` build fresh frozen objects
every call; `useSyncExternalStore` compares with `Object.is` and
either tears or infinite-loops.

**Fix.** Added a monotonic `snapshotVersion` to the handle (bumped on
`rebuild()`/`reload()`/`initialise()`), exposed a public `version()`
method on `FlagsHandle`, and cached `getAll(ctx)` / `getDetail(key,
ctx)` per `(ctx-reference, version)` tuple inside the handle. Caches
are invalidated with the version bump. The React adapter therefore
needs no extra wrapper memoization — same `(ctx, version)` returns the
same identity.

**Files.** `src/core/flags.ts`, `src/types/flags.ts`,
`src/adapters/react/index.ts` (added a clarifying note).

### 4. `composeSources` drops the `segments` portion — agree, fixed

**Concern.** `mergeSnapshots` in `sources/compose/index.ts` only loops
`layer.flags`, never `layer.segments`. The internal
`core/snapshot.ts:composeSnapshots` does merge them, so consumers using
the public `composeSources` from the root entry-point silently lose
segments-driven targeting once a JSON / remote layer carries them.

**Fix.** Mirrored the segments loop from `core/snapshot.ts:51-55`,
moved both flags + seenLayers + segments to `Object.create(null)` for
the same proto-pollution rationale as item 8.

**Files.** `src/sources/compose/index.ts`.

## Majors

### 5. Evaluation order vs PLAN — disagree, kept; clarified comment

**Concern.** Reviewer reads PLAN §1 ("1. resolve source layer → 2.
select environment override → 3. walk targeting rules → 4. apply
percentage rollout") and notes the implementation applies env
*after* rules.

**Reasoning to keep.** The PLAN snippet at §123 is the high-level
file-tree comment summary. The detailed evaluation pseudocode lives at
PLAN §3.1 (lines ~2020-2083) and explicitly defers env to *after* the
rules walk: env is computed up-front but applied at the
"rules-existed-but-none-matched" fallthrough or before
`spec.default`. The implementation matches §3.1 exactly. Targeting
rules are an explicit user-defined override; environments are a coarse
default switch — a matched `{ when: ..., value: X }` rule should beat
a per-env default, which is what our (and the spec's) order produces.

**Action taken.** Added a comment to `evaluate.ts:46-55` explicitly
calling out that env is read up front but applied after rules walk,
with the rationale, so the next reader doesn't make the same misread.

**Files.** `src/core/evaluate.ts`.

### 6. `regex` matcher short-circuits other ops — agree, fixed

**Concern.** The `regex` branch in `evaluateMatcher` did `return true`
after a single matcher hit, dropping every other op in the same
`Matcher` object. Combined with no parse-time enforcement of
"single-key matchers", JSON like `{ "regex": "^x$", "eq": "x" }` would
short-circuit on the regex.

**Fix.** Replaced `return true` with `if (!ok) return false;` — the
loop now falls through and evaluates every op in the matcher. The
regex op still gets the full matcher object (so it can read its
sibling `flags` key). See item 7 for the parse-time defence.

**Files.** `src/core/rules.ts`.

### 7. Unknown matcher operators silently match nothing — agree, fixed

**Concern.** A typo like `{ "equals": "pro" }` (instead of
`{ "eq": "pro" }`) would slip through `parseMatcher` verbatim, then
`getMatcher(op)` returns `undefined` at eval time → rule silently
fails to `false`.

**Fix.** Added `KNOWN_MATCHER_OPS` allowlist in
`sources/json/parse.ts` and validate it inside `parseMatcher`. `flags`
is recognised as the `regex` sibling modifier rather than a
standalone op. The eval-time `degrade-to-false` fallback in
`core/rules.ts` is intentionally kept for runtime-loaded extension
operators that haven't been registered yet.

**Files.** `src/sources/json/parse.ts`.

### 8. Prototype-pollution surface from JSON sources — agree, fixed

**Concern.** `flags[key] = ...` with `key === "__proto__"` mutates
`Object.prototype` on V8. Same in `segments`, `parseFlagEntry.base`,
`parseRollout.out`. Likewise in `env/index.ts` (saved by the
schema-allowlist in practice).

**Fix.** Two-layer defence:

1. Switched every untrusted-input map to `Object.create(null)` —
   `flags`, `segments`, env-overrides, rule output, rule-group output,
   environments overlay, variants weights, env source's flags map.
2. Added `assertSafeKey(scope, key)` for top-level `flags` /
   `segments` keys (throws `INVALID_SCHEMA` on `__proto__` /
   `constructor` / `prototype`); silently skipped at attribute-name
   and variant-name layers.

**Files.** `src/sources/json/parse.ts`, `src/sources/env/index.ts`,
`src/sources/compose/index.ts`.

### 9. Documented `peek()` not implemented — disagree on adding, agree on PLAN cleanup

**Concern.** PLAN §2.1 talks about `peek()` but the handle doesn't
expose it.

**Reasoning to keep no `peek()`.** PLAN's own reviewer-note section
(line ~3181, "Medium — naming: `peek()` and `degraded`") explicitly
agreed: "**Action — agreed.** `peek` → `getDetail` (pairs with
`get`)." So `peek` was renamed. The §2.1 / §9.12 / §3.0 diagram
mentions of `peek()` are stale leftovers, not a feature gap.

**Action taken.** Updated the three stale `peek()` references in
PLAN.md to read `getDetail()` so the doc is internally consistent.

**Files.** `PLAN.md`.

### 10. `<FlagsProvider initialSnapshot>` thrown away — agree, fixed

**Concern.** The prop is read and `void`-discarded.

**Fix.** Threaded `initialSnapshot` into `ContextValue`. `useFlag`'s
`useSyncExternalStore` call now passes a real `getServerSnapshot`
that sources the value from `initialSnapshot.flags[key].default` so
SSR-rendered HTML matches the first client read. Per-key snapshot is
sufficient for the SSR case; `useFlags` and `useFlagResult` keep the
client snapshot for both server + client (the handle's stable cache
makes that safe — see item 3).

**Files.** `src/adapters/react/index.ts`.

### 11. `AuditEntry` lacks `lastTouched` — agree, fixed

**Concern.** PLAN §1 promises "JSON report of flags + their last-touch
git blame".

**Fix.** Added optional `lastTouched: string` to `AuditEntry` and
populated it from `git log -1 --format=%cI -- <file>` via
`node:child_process.spawn`. Best-effort: silently omitted on git
failure / untracked file / missing git binary. Kept it as a single
file-level value rather than per-key blame for now (the audit reads a
single `flags.json`; per-flag blame would require per-line ranges).

**Files.** `src/cli/audit.ts`.

## Mediums

### 12. Initial-load race between source `subscribe` and `Promise.all` — agree, fixed

**Concern.** A source firing `subscribe` callbacks during the initial
`Promise.all(sources.map(s => s.load()))` would have `rebuild()`
overwrite `merged`, then `initialise` clobbers it again.

**Fix.** Added `initialised` boolean. Source-driven `rebuild()`
short-circuits until `initialise` flips it true. `reload()` also
flips it true (in case the consumer skips the implicit initialise).

**Files.** `src/core/flags.ts`.

### 13. `RULE_EVAL_ERROR` indistinguishable from "matched false" — agree, fixed

**Concern.** A throwing `custom` matcher should be visible in
observability with `code: 'RULE_EVAL_ERROR'`, not a silent `false`.

**Fix.**

1. `custom` matcher in `matchers/extended/index.ts` no longer swallows
   the throw — it propagates to `evaluateMatcher` which is the
   one with the structured catch.
2. `evaluateMatcher` accepts a `reportError` callback and forwards
   `{ kind: 'matcher-throw', name, cause }` on catch.
3. `flags.ts:evaluate` builds a `reportRuleError` adapter, captures
   the error, and calls `emit(result, ctx, env, 'RULE_EVAL_ERROR',
   message)` so the user's `onEvaluation` hook sees `event.error`.

**Files.** `src/core/rules.ts`, `src/core/evaluate.ts`,
`src/core/flags.ts`, `src/matchers/extended/index.ts`.

### 14. `fnv1a32` is UTF-16, not bytes — agree, documented

**Concern.** Doc says "deterministic across every supported runtime"
without qualifying that JS-family `charCodeAt` produces UTF-16 code
units, not bytes. Cross-language byte-FNV agreement won't match for
non-ASCII subject ids.

**Reasoning to document rather than rewrite.** Switching to
`TextEncoder().encode(input)` would change every existing bucket
assignment for non-ASCII input strings — a silent behaviour change in
production rollouts. Within JS-family runtimes the existing
implementation is deterministic and that's the documented
guarantee. We can revisit a `fnv1a32Bytes` opt-in later if we get a
real cross-language requirement.

**Action taken.** Updated JSDoc on `fnv1a32` to spell out the
JS-family-only scope and the cross-language workaround (normalise to
ASCII subject ids on both sides).

**Files.** `src/core/hash.ts`.

### 15. `coerceJson` returns the raw reference unfrozen — agree, fixed

**Concern.** A consumer mutating the object returned from
`flags.get('jsonFlag')` mutates the underlying `FlagSpec.default` for
every other reader.

**Fix.** Defensively `deepFreeze` both branches: the
`JSON.parse`-from-string path and the already-an-object path. Existing
spec-level deep-freeze in `defaultsSource` still applies on
construction; this catches the env-source / runtime-injected paths.

**Files.** `src/core/coerce.ts`.

## Lows

### 16. PostHog doc mentions a non-existent `forwardAttributes` — agree, struck

Removed the misleading line. Pointed users at `redactSubject: (s) =>
s` which is the actual mechanism (it runs upstream of every tap, so
opt-in there gives the PostHog tap attributes too).

**Files.** `src/observe/posthog.ts`.

### 17. `arguments.length` default-value sentinel undocumented — agree, documented

Added a paragraph to the `FlagsHandle` JSDoc spelling out that
default-presence is detected via `arguments.length`, with a concrete
warning about callers that build args via spread (`fn(...args)`).

**Files.** `src/types/flags.ts`.

### 18. `Rollout<unknown>` cast soup — agree, cleaned

Removed the four `as unknown as Rollout<unknown>` cast pairs in
`evaluate.ts` by hoisting the rollout to a typed local. `Rule` import
removed (now unused). No behaviour change.

**Files.** `src/core/evaluate.ts`.

### 19. Env collision-warning re-scans process.env on every reload — agree, fixed

Added a `scannedKeys: Set<string>` to the env source's closure;
`buildSnapshot` now skips keys it's already inspected for the
collision warning. The `warnedCollisions` set already deduped warnings
themselves, but iterating `Object.keys(env)` on every reload was the
real cost.

**Files.** `src/sources/env/index.ts`.

### 20. Size-budget aspirational claim — noted, no change yet

The reviewer flagged that `src/index.ts` re-exports
`composeSources` + `defaultsSource` + the full `evaluate.ts → … →
validate.ts` graph, and that `validate.ts` alone (200 LOC of error
strings) probably blows the ≤ 3 KB gzipped budget without a `__DEV__`
gate.

This is a real concern but it's a packaging change (tsup config +
build script) outside the scope of this code-review pass. Filing
follow-up: gate `validateSchema`'s message strings behind `__DEV__`,
run `pnpm size`, and adjust budgets in CI before merging the budget
target itself. No source change here.

**Files.** none (follow-up).
