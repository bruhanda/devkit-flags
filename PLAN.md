# `@devkit/flags` — Architecture Plan

> Zero-dependency, type-safe, isomorphic feature flags for TypeScript. The
> core engine targets **≤3 KB gzipped**; every source (JSON / env / remote)
> and every framework adapter (React, Next.js, SvelteKit, Vue, Hono,
> Express, OpenFeature) lives behind its own subpath export and is pulled
> in only when the consumer imports it. A Vercel Edge build using only the
> in-code defaults source ships **~1.8 KB total**. Runs unmodified in
> **Node 20+, Bun 1.0+, Deno 1.40+, Cloudflare Workers, Vercel Edge,
> Netlify Edge**, the browser and React Native — through Web Standards
> (`fetch`, `crypto.subtle` is **not** required; bucketing uses pure-JS
> FNV-1a 32-bit, no Node-only APIs).
>
> Four flag value kinds (`boolean` / `string` / `number` / `JSON`),
> percentage rollouts via consistent hashing (FNV-1a) over a stable
> `(salt, flagKey, subjectId)` triple, targeting rules with `eq` / `in` /
> `gt` / `gte` / `lt` / `lte` / `regex` / `exists` / `custom` matchers and
> `AND` / `OR` / `NOT` composition, multi-environment overrides
> (`dev` / `staging` / `prod` plus arbitrary user-defined names), pluggable
> sources with priority composition, opt-in hot-reload (Node `fs.watch` for
> JSON, polling or SSE for remote), and observability hooks
> (`onEvaluation`) suitable for streaming evaluations into PostHog,
> Mixpanel, Datadog or a homegrown analytics pipe.
>
> Positioned to **fill the gap between DIY `process.env` and heavyweight
> SaaS / self-hosted platforms**. `unleash-client` (315 k weekly) requires
> a self-hosted Postgres + Unleash server; `@growthbook/growthbook` (574 k
> weekly) is ~16 KB and experiment-first; `launchdarkly-node-server-sdk`
> (575 k weekly) is paid + 50 KB+; `flagged` (44 k weekly) is React-only
> and lacks rollouts/targeting; `@vercel/flags` is Next.js / Vercel-locked;
> `@openfeature/server-sdk` is a spec layer that needs a provider to do
> anything useful. We compete on **zero infra + zero deps + type-safety
> from `defineFlags<T>()` + bundle size**, with a deliberate growth path
> through subpath sources and an OpenFeature provider so consumers can
> migrate to LaunchDarkly / ConfigCat / GrowthBook later **without
> rewriting call sites**.
>
> Source of truth for the market problem statement is
> `reports/09-feature-flags-lite.json` (id `09`, dated 2026-04-27).

---

## Table of Contents

1.  [Project Structure](#1-project-structure)
2.  [Public API Design](#2-public-api-design)
3.  [Internal Architecture](#3-internal-architecture)
4.  [Type System](#4-type-system)
5.  [Error Handling Strategy](#5-error-handling-strategy)
6.  [Bundle & Tree-shaking Plan](#6-bundle--tree-shaking-plan)
7.  [Dependencies](#7-dependencies)
8.  [Configuration](#8-configuration)
9.  [Edge Cases](#9-edge-cases)
10. [Out of Scope (1.0)](#10-out-of-scope-10)

---

## 1. Project Structure

Every file in `src/` is single-purpose. No file imports from `dist/`. No
file imports through a sibling `index.ts` re-export — re-exports happen
only at **package boundaries** (i.e. files referenced from
`package.json#exports`). This keeps the dependency graph **acyclic**,
side-effect-free, and aggressively tree-shakeable: a consumer who imports
only `@devkit/flags` and `@devkit/flags/sources/json` does not pull in
the env source, the remote source, the React adapter, the OpenFeature
provider, or the CLI.

```
devkit-flags/
├── PLAN.md                         # this document
├── README.md                       # 5-min getting started + API reference
├── LICENSE                         # MIT
├── CHANGELOG.md                    # changesets-managed
├── package.json                    # see §8
├── tsconfig.json                   # strict, ES2024, NodeNext, declaration
├── tsconfig.build.json             # build-only overrides (excludes test/)
├── tsup.config.ts                  # multi-entry esm+dts bundler
├── vitest.config.ts                # node + jsdom workspace projects
├── biome.json                      # lint + format (replaces eslint+prettier)
├── .size-limit.json                # per-entry budget (CI gate)
├── .gitignore                      # see §8.4
├── .npmignore                      # narrows publish to dist/ + LICENSE/README
├── .changeset/
│   └── config.json
├── .github/
│   └── workflows/
│       ├── ci.yml                  # test + typecheck + size-limit + attw + publint
│       └── release.yml             # changesets publish on main
│
├── src/
│   ├── index.ts                    # core public entrypoint
│   │                               # re-exports defineFlags, createFlags,
│   │                               # defaultsSource, FlagsError, type helpers
│   │                               # — nothing else
│   │
│   ├── core/
│   │   ├── define.ts               # defineFlags<TSchema>() — the type-safe
│   │   │                           # declarative builder. Returns a frozen
│   │   │                           # FlagsHandle<TSchema>. Composes
│   │   │                           # createFlags() under the hood; the
│   │   │                           # generic-only path that gives consumers
│   │   │                           # full autocomplete on flag keys + values.
│   │   ├── flags.ts                # createFlags(config) — runtime factory
│   │   │                           # used by both defineFlags and consumers
│   │   │                           # who build the schema dynamically (JSON
│   │   │                           # config, codegen, REPL). Returns the
│   │   │                           # same FlagsHandle shape.
│   │   ├── evaluate.ts             # evaluateFlag(spec, ctx, env) — single
│   │   │                           # pure pipeline:
│   │   │                           #   1. resolve source layer (defaults →
│   │   │                           #      JSON → env → remote, last wins)
│   │   │                           #   2. select environment override
│   │   │                           #   3. walk targeting rules
│   │   │                           #   4. apply percentage rollout (bucket)
│   │   │                           #   5. coerce value to declared kind
│   │   │                           # Throws nothing; returns a Result whose
│   │   │                           # `reason` enum tells the caller why
│   │   │                           # this value was chosen.
│   │   ├── rules.ts                # matchRule(rule, ctx) — recursive
│   │   │                           # AND/OR/NOT walker over the
│   │   │                           # discriminated `Rule` union. Pure;
│   │   │                           # never throws on missing context
│   │   │                           # attributes (a missing key fails the
│   │   │                           # match unless the operator is `exists`
│   │   │                           # /`!exists`).
│   │   ├── matchers.ts             # operator implementations: eq, neq, in,
│   │   │                           # nin, gt, gte, lt, lte, regex, exists,
│   │   │                           # contains, startsWith, endsWith, custom
│   │   │                           # (function-form). Each matcher is a
│   │   │                           # 1-2 line pure function so dead code
│   │   │                           # elimination removes unused operators.
│   │   ├── bucket.ts               # bucketFor(salt, flagKey, subjectId,
│   │   │                           #    percentage) → boolean
│   │   │                           # plus variantBucketFor(...weights[]) →
│   │   │                           #    chosenIndex for multivariate.
│   │   │                           # Uses FNV-1a; produces a stable
│   │   │                           # [0, 10000) integer bucket.
│   │   ├── hash.ts                 # FNV-1a 32-bit. Single 14-LOC pure
│   │   │                           # function; the only reason this isn't
│   │   │                           # inlined into bucket.ts is testability
│   │   │                           # and the fact that observability hooks
│   │   │                           # may want to hash custom keys.
│   │   ├── env.ts                  # resolveEnvironment(config, override) →
│   │   │                           # the active environment string. Looks
│   │   │                           # at (in order): explicit override,
│   │   │                           # NODE_ENV, ENVIRONMENT, falls back to
│   │   │                           # 'production'. Single portable runtime
│   │   │                           # probe; banned via Biome rule from being
│   │   │                           # inlined elsewhere for Workers safety.
│   │   ├── coerce.ts               # coerceValue(raw, kind) — safely cast
│   │   │                           # a possibly-string env-var or JSON
│   │   │                           # leaf into the declared FlagKind.
│   │   │                           # Throws FlagsError('TYPE_MISMATCH') on
│   │   │                           # unrepresentable values.
│   │   ├── invariant.ts            # invariant(cond, code, msg) →
│   │   │                           # FlagsError. Cheap, inline-friendly,
│   │   │                           # used at config boundaries only.
│   │   ├── flag-spec.ts            # FlagSpec discriminated union (data).
│   │   │                           # Core has zero static knowledge of any
│   │   │                           # source; only the spec shape and the
│   │   │                           # Source contract.
│   │   ├── source-contract.ts      # FlagSource interface (type-only).
│   │   ├── snapshot.ts             # Snapshot — frozen, in-memory image of
│   │   │                           # the merged source layers. Reads happen
│   │   │                           # against a snapshot so an in-flight
│   │   │                           # source reload never tears values
│   │   │                           # mid-evaluation.
│   │   └── observe.ts              # onEvaluation hook fan-out. Internal
│   │                               # plumbing; the public hook type lives
│   │                               # in src/observe/index.ts.
│   │
│   ├── sources/
│   │   ├── defaults/
│   │   │   └── index.ts            # defaultsSource(schema) — turns the
│   │   │                           # static defaults from defineFlags()
│   │   │                           # into a FlagSource. Always present.
│   │   │                           # Lives in core/ but is re-exported
│   │   │                           # from the root entrypoint for
│   │   │                           # consumers who build flags dynamically.
│   │   ├── json/
│   │   │   ├── index.ts            # createJsonSource(input, opts?) where
│   │   │   │                       # input may be a path, URL, raw object
│   │   │   │                       # or a function returning any of those.
│   │   │   │                       # Watching is Node-only and opt-in via
│   │   │   │                       # opts.watch === true.
│   │   │   ├── parse.ts            # parseFlagsJson(json) — schema-light
│   │   │   │                       # validator that turns the on-disk JSON
│   │   │   │                       # into FlagSpec[]; produces detailed
│   │   │   │                       # `FlagsError('JSON_PARSE_ERROR', ...)`
│   │   │   │                       # with the offending JSON pointer.
│   │   │   └── watch.ts            # node:fs.watch driver — guarded behind
│   │   │                           # a dynamic import so non-Node runtimes
│   │   │                           # never see the import.
│   │   ├── env/
│   │   │   ├── index.ts            # createEnvSource(opts?) — reads
│   │   │   │                       # `process.env` (or `Deno.env` /
│   │   │   │                       # `Bun.env` via globalThis) for vars
│   │   │   │                       # matching `${prefix}${flagKey}` (default
│   │   │   │                       # prefix `FLAG_`). Boolean-coerces
│   │   │   │                       # 'true'/'1'/'on'/'yes' (case-insensitive);
│   │   │   │                       # number-coerces via `Number(v)` rejecting
│   │   │   │                       # NaN; JSON-coerces values starting with
│   │   │   │                       # `{` or `[`; otherwise leaves as string.
│   │   │   └── normalize-key.ts    # Translates flag key 'newCheckout' →
│   │   │                           # 'NEW_CHECKOUT' env-var convention.
│   │   ├── remote/
│   │   │   ├── index.ts            # createRemoteSource(url, opts?) — fetch
│   │   │   │                       # JSON every `pollInterval` (default
│   │   │   │                       # 60 s). On the first call the source
│   │   │   │                       # blocks until the initial fetch
│   │   │   │                       # resolves; subsequent reads are
│   │   │   │                       # synchronous against the snapshot.
│   │   │   ├── poll.ts             # Internal interval driver — uses
│   │   │   │                       # `globalThis.setInterval` only,
│   │   │   │                       # never Node `Timer` types.
│   │   │   ├── sse.ts              # Optional Server-Sent Events driver —
│   │   │   │                       # zero deps, uses `EventSource` when
│   │   │   │                       # globally available, falls back to a
│   │   │   │                       # 60-LOC fetch-stream parser otherwise.
│   │   │   ├── etag.ts             # If-None-Match / 304 handling so
│   │   │   │                       # polling pings a CDN cheaply.
│   │   │   └── fetch-json.ts       # fetchJson<T>(url, init) — abort-aware,
│   │   │                           # respects upstream `Cache-Control`,
│   │   │                           # 1 KiB JSON limit by default.
│   │   └── compose/
│   │       └── index.ts            # composeSources(sources, opts?) →
│   │                               # FlagSource that overlays later sources
│   │                               # over earlier ones. The default order
│   │                               # documented in the README is:
│   │                               #   defaults → json → env → remote
│   │                               # so an env override always beats a JSON
│   │                               # value, and a remote update always
│   │                               # beats both when present.
│   │
│   ├── adapters/
│   │   ├── react/
│   │   │   ├── index.ts            # FlagsProvider + useFlag(key) +
│   │   │   │                       # useFlagValue(key) + useFlags() +
│   │   │   │                       # withFlag(key, fallback) HOC +
│   │   │   │                       # <Flag name>...</Flag> render component.
│   │   │   ├── context.ts          # React.Context holding the FlagsHandle.
│   │   │   ├── hooks.ts            # the four useFlag* hooks; each is a
│   │   │   │                       # ~6-LOC `useSyncExternalStore` shell so
│   │   │   │                       # SSR + RSC streams render with a stable
│   │   │   │                       # value and concurrent mode is safe.
│   │   │   └── components.ts       # <Flag>, <Variant>, <FallbackBoundary>.
│   │   ├── next/
│   │   │   ├── index.ts            # Next.js App Router server-side helper:
│   │   │   │                       # getFlag(key) for RSC; createFlagsRoute
│   │   │   │                       # for Route Handlers; flagsMiddleware
│   │   │   │                       # that hydrates per-request context from
│   │   │   │                       # cookies / headers.
│   │   │   ├── rsc.ts              # cache()-wrapped getFlag for RSC.
│   │   │   ├── route.ts            # Route Handler factory — exposes a
│   │   │   │                       # `/api/flags` endpoint that emits the
│   │   │   │                       # current snapshot for a Pages Router
│   │   │   │                       # client to bootstrap from.
│   │   │   └── middleware.ts       # Edge middleware that injects the
│   │   │                           # subject's bucket into a header for
│   │   │                           # downstream RSC reads.
│   │   ├── sveltekit/
│   │   │   ├── index.ts            # flagsHandle(flags) — SvelteKit
│   │   │   │                       # `handle` hook; populates `event.locals.flags`.
│   │   │   └── store.ts            # writable<FlagsHandle> store that hot-
│   │   │                           # reload reflects on the client.
│   │   ├── vue/
│   │   │   ├── index.ts            # createFlagsPlugin + useFlag composable.
│   │   │   └── plugin.ts           # app.use(createFlagsPlugin(handle)).
│   │   ├── hono/
│   │   │   └── index.ts            # honoFlags(handle) middleware — sets
│   │   │                           # `c.var.flags` and `c.var.flag(key)`
│   │   │                           # helper resolved from request cookies.
│   │   ├── express/
│   │   │   └── index.ts            # expressFlags(handle) → (req, res, next)
│   │   │                           # middleware. Adds `req.flag(key)`.
│   │   └── openfeature/
│   │       ├── index.ts            # createOpenFeatureProvider(handle) —
│   │       │                       # implements the OpenFeature Provider
│   │       │                       # contract so consumers can drop our
│   │       │                       # flags engine into any OpenFeature
│   │       │                       # client. Lazy-loaded; OpenFeature SDK
│   │       │                       # is a peer dep, not a runtime dep.
│   │       └── translate.ts        # Bidirectional mapping between our
│   │                               # `EvaluationReason` and OpenFeature's
│   │                               # `ResolutionReason` enum.
│   │
│   ├── observe/
│   │   ├── index.ts                # Observability subpath — the
│   │   │                           # `OnEvaluation` hook type, the
│   │   │                           # `EvaluationEvent` payload, plus
│   │   │                           # ready-made tap helpers:
│   │   │                           # toConsole(), toPostHog(client),
│   │   │                           # toMixpanel(client), toEndpoint(url).
│   │   ├── posthog.ts              # Best-effort PostHog tap (no PostHog
│   │   │                           # dep — accepts a `{capture(...)}`
│   │   │                           # duck-typed client).
│   │   └── endpoint.ts             # Generic POST-to-URL batching tap.
│   │
│   ├── errors/
│   │   ├── index.ts                # errors subpath barrel.
│   │   ├── base.ts                 # FlagsError extends Error + .is() guard.
│   │   └── codes.ts                # FLAGS_ERROR_CODES const + type.
│   │
│   ├── types/
│   │   ├── index.ts                # type-only public surface, no runtime.
│   │   ├── flag-kind.ts            # FlagKind = 'boolean' | 'string' |
│   │   │                           # 'number' | 'json'; FlagValueOf<K> map.
│   │   ├── flag-spec.ts            # FlagSpec<TKind, TValue> discriminated
│   │   │                           # union (boolean | string | number | json).
│   │   ├── flag-schema.ts          # FlagSchema = Record<string, FlagSpec>
│   │   │                           # plus type helpers FlagKeysOf<S>,
│   │   │                           # FlagValueOf<S, K>.
│   │   ├── context.ts              # EvaluationContext: subject (id +
│   │   │                           # attributes Record<string, Json>) +
│   │   │                           # environment.
│   │   ├── rules.ts                # Rule | RuleGroup discriminated union;
│   │   │                           # Operator string-union.
│   │   ├── source.ts               # FlagSource interface (load, subscribe,
│   │   │                           # close, snapshot()).
│   │   ├── flags.ts                # FlagsHandle<S> public surface.
│   │   ├── result.ts               # EvaluationResult<TValue> +
│   │   │                           # EvaluationReason enum.
│   │   ├── observability.ts        # OnEvaluation hook + EvaluationEvent.
│   │   ├── env.ts                  # Environment string-brand type.
│   │   └── json.ts                 # Json type (recursive); Jsonable type.
│   │
│   ├── cli/
│   │   ├── index.ts                # `flags` CLI entry — a 60-LOC arg
│   │   │                           # parser fans out to one of three
│   │   │                           # subcommands.
│   │   ├── codegen.ts              # `flags codegen` — reads flags.json,
│   │   │                           # writes a TS module with a typed
│   │   │                           # defineFlags<{...}>() call so consumers
│   │   │                           # get autocomplete in editors that
│   │   │                           # don't run `tsc --watch`.
│   │   ├── lint.ts                 # `flags lint` — scans the project for
│   │   │                           # `flag('xxx')` / `flags.get('xxx')`
│   │   │                           # call sites and reports keys present
│   │   │                           # in flags.json but never read (dead
│   │   │                           # flags) and keys read but missing in
│   │   │                           # flags.json (typos).
│   │   ├── audit.ts                # `flags audit` — emits a JSON report
│   │   │                           # of flags + their last-touch git blame.
│   │   ├── parse-args.ts           # Vendored 50-LOC arg parser — no
│   │   │                           # commander/yargs dep.
│   │   └── fs-walk.ts              # Tiny async generator that yields
│   │                               # source files matching glob; used by
│   │                               # `lint` and `audit`.
│   │
│   └── utils/
│       ├── freeze.ts               # deepFreeze() — used to freeze the
│       │                           # FlagsHandle and snapshots so callers
│       │                           # can't mutate them.
│       ├── safe-json.ts            # parseJson<T>() that returns a Result
│       │                           # rather than throwing on malformed
│       │                           # input. Used by every JSON boundary.
│       ├── runtime.ts              # detectRuntime() — single probe for
│       │                           # 'node' | 'bun' | 'deno' | 'workers'
│       │                           # | 'browser'. The ONLY file allowed
│       │                           # to inspect process / Deno / Bun
│       │                           # globals; banned everywhere else.
│       └── once.ts                 # once(fn) — memoise an async factory
│                                   # so concurrent first-readers share a
│                                   # single in-flight promise (used by
│                                   # remote source initial fetch).
│
├── test/
│   ├── core/
│   │   ├── define.test.ts          # defineFlags type narrowing matrix
│   │   ├── evaluate.test.ts        # full pipeline matrix per flag kind
│   │   ├── rules.test.ts           # AND/OR/NOT compositions, edge cases
│   │   ├── matchers.test.ts        # every operator × every value type
│   │   ├── bucket.test.ts          # 100 k subjects @ 5/25/50/95 % bands;
│   │   │                           # asserts ≤ 1 % deviation from target
│   │   │                           # AND that ramp-up never demotes a
│   │   │                           # subject already inside the band.
│   │   ├── hash.test.ts            # FNV-1a known vectors
│   │   ├── env.test.ts             # NODE_ENV / ENVIRONMENT precedence
│   │   ├── coerce.test.ts          # boolean/number/json coercion edges
│   │   └── snapshot.test.ts        # frozen-snapshot tear-protection
│   ├── sources/
│   │   ├── defaults.test.ts
│   │   ├── json.test.ts            # parse + watch on a tmp dir
│   │   ├── env.test.ts
│   │   ├── remote.test.ts          # MSW fixture; 304 ETag handling;
│   │   │                           # SSE client mock
│   │   └── compose.test.ts         # priority ordering, hot-reload merge
│   ├── adapters/
│   │   ├── react.test.tsx          # @testing-library/react + jsdom
│   │   ├── next.test.ts            # mocked NextRequest / RSC
│   │   ├── sveltekit.test.ts       # event mock
│   │   ├── vue.test.ts             # @vue/test-utils
│   │   ├── hono.test.ts
│   │   ├── express.test.ts         # supertest
│   │   └── openfeature.test.ts     # spec conformance smoke
│   ├── observe/
│   │   ├── posthog.test.ts
│   │   └── endpoint.test.ts
│   ├── cli/
│   │   ├── codegen.test.ts
│   │   ├── lint.test.ts
│   │   └── audit.test.ts
│   ├── runtime/
│   │   ├── workers.test.ts         # @cloudflare/vitest-pool-workers
│   │   └── edge.test.ts            # confirm no `process` references slip
│   ├── types/
│   │   └── inference.test-d.ts     # vitest --typecheck
│   └── correctness/
│       ├── rollout-stability.test.ts # bucket stability across reloads
│       ├── salt-rotation.test.ts     # documented re-bucketing semantics
│       └── concurrency.test.ts       # 1 k parallel reads on a hot reload
│
└── examples/                       # not published — referenced from README
    ├── react-vite/
    ├── nextjs-rsc/
    ├── sveltekit-edge/
    ├── hono-cf-workers/
    ├── deno-deploy/
    ├── express-node/
    └── ai-llm-rollout/             # gradual rollout of a new model;
                                    # showcases observability hook → PostHog
```

---

## 2. Public API Design

This section is the complete TypeScript surface — everything the consumer
can import. Anything **not** listed here is **internal**, may break in a
patch release, and is tagged `@internal` in TSDoc so `api-extractor`
strips it from the published `.d.ts` rollup.

### 2.1 Root entrypoint — `@devkit/flags`

```ts
/**
 * Declare a typed schema of feature flags. Returns a `FlagsHandle` that
 * is `Object.freeze`d and safe to share across requests, edge isolates
 * and React renders.
 *
 * The schema is the **single source of truth** for compile-time names
 * and value types. Every subsequent `flags.get('newCheckout', ctx)` call
 * narrows the return type to the declared `FlagKind` (boolean / string /
 * number / Json) and rejects unknown keys at the call site — no
 * `as const` ceremony, no string-typed APIs.
 *
 * The same handle works on Node, Bun, Deno, Cloudflare Workers, Vercel
 * Edge and the browser. Source loading is lazy: `defaultsSource` runs
 * synchronously at construction, every other source is awaited the first
 * time `flags.get()` is called. Subsequent calls hit a frozen in-memory
 * snapshot (~80 ns per evaluation on Node 20).
 *
 * @typeParam TSchema  Inferred from the `flags` argument; do **not**
 *                     pass it manually — let TS infer the literal types
 *                     of every default value so `get()` can narrow.
 *
 * @param config.flags        The schema — a `Record<string, FlagSpec>`.
 *                            Each entry declares the flag's kind, default,
 *                            optional environment overrides, optional
 *                            targeting rules and optional rollout.
 * @param config.environment  Active environment. When omitted, resolves
 *                            via `process.env.NODE_ENV` →
 *                            `process.env.ENVIRONMENT` → `'production'`.
 *                            Must be one of the keys present in any
 *                            flag's `environments` map (validated lazily;
 *                            unknown environments fall back to defaults).
 * @param config.sources      Optional ordered list of additional sources
 *                            (JSON / env / remote). Later sources win —
 *                            merged shallowly per flag key. The implicit
 *                            `defaultsSource(schema)` is always at index 0.
 * @param config.subjectId    Default subject extractor — receives the
 *                            `EvaluationContext` and returns the stable
 *                            ID used for percentage bucketing. When
 *                            omitted, defaults to `ctx.subject?.id ?? ''`
 *                            (anonymous subjects always fall outside any
 *                            partial rollout — pass an explicit anon-ID
 *                            cookie if you want bucket stability for
 *                            logged-out users).
 * @param config.salt         Bucketing salt. Rotating the salt invalidates
 *                            every subject's bucket — used to "reshuffle"
 *                            an experiment. See §9.4 for documented
 *                            re-bucketing semantics.
 * @param config.onEvaluation Observability hook. Fires once per
 *                            `flags.get()` call (after coercion, before
 *                            return). Errors thrown inside the hook are
 *                            caught and logged via `console.error`; they
 *                            never propagate to the caller.
 *
 * @returns Frozen `FlagsHandle<TSchema>` exposing
 *          `.get(key, ctx?)`, `.getAll(ctx?)`, `.peek(key, ctx?)`,
 *          `.subscribe(listener)`, `.reload()`, `.dispose()` and
 *          read-only `.config` / `.snapshot()`.
 *
 * @example  Minimal — boolean kill switch
 *   import { defineFlags } from '@devkit/flags';
 *
 *   export const flags = defineFlags({
 *     flags: {
 *       newCheckout: { kind: 'boolean', default: false },
 *       maintenance: { kind: 'boolean', default: false },
 *     },
 *   });
 *
 *   if (await flags.get('newCheckout')) {
 *     // ...
 *   }
 *
 * @example  Multivariate string flag with environment overrides
 *   const flags = defineFlags({
 *     flags: {
 *       checkoutVariant: {
 *         kind: 'string',
 *         default: 'control',
 *         environments: { staging: 'variantA', dev: 'variantB' },
 *       },
 *     },
 *   });
 *
 * @example  Percentage rollout with consistent hashing
 *   const flags = defineFlags({
 *     flags: {
 *       newCheckout: {
 *         kind: 'boolean',
 *         default: false,
 *         rollout: { percentage: 25 }, // 25 % of subjects
 *       },
 *     },
 *   });
 *
 *   await flags.get('newCheckout', { subject: { id: 'user_42' } });
 *
 * @example  Targeting rules — pro-tier users only
 *   const flags = defineFlags({
 *     flags: {
 *       advancedAnalytics: {
 *         kind: 'boolean',
 *         default: false,
 *         rules: [
 *           { when: { plan: { eq: 'pro' } }, value: true },
 *         ],
 *       },
 *     },
 *   });
 *
 * @example  Gradual rollout to pro users only
 *   const flags = defineFlags({
 *     flags: {
 *       betaFeature: {
 *         kind: 'boolean',
 *         default: false,
 *         rules: [
 *           {
 *             when: { plan: { in: ['pro', 'enterprise'] } },
 *             rollout: { percentage: 50 },
 *           },
 *         ],
 *       },
 *     },
 *   });
 */
export function defineFlags<TSchema extends FlagSchema>(
  config: DefineFlagsConfig<TSchema>,
): FlagsHandle<TSchema>;
```

```ts
/**
 * Lower-level factory used internally by `defineFlags`. Reach for it
 * when the schema is **not** a TS literal — for example, when you load
 * the schema from a JSON file at runtime or generate it from a CMS.
 *
 * The returned handle is structurally identical to `defineFlags`'s, but
 * `get()` is typed `<T = unknown>(key: string, ctx?) => Promise<T>` —
 * you lose the per-key narrowing. Pair it with `flags codegen` (CLI) for
 * the best of both worlds.
 *
 * @example
 *   const schema: FlagSchema = await loadFromCms();
 *   const flags = createFlags({ flags: schema });
 *   const v: unknown = await flags.get('checkoutVariant');
 */
export function createFlags(
  config: CreateFlagsConfig,
): FlagsHandle;

/**
 * Re-export of the implicit defaults source so consumers who construct
 * the handle dynamically can still inject other sources around it.
 *
 * @example
 *   createFlags({
 *     flags: schema,
 *     sources: [
 *       defaultsSource(schema),     // implicit; shown for clarity
 *       createJsonSource('./flags.json'),
 *       createEnvSource(),
 *     ],
 *   });
 */
export function defaultsSource(schema: FlagSchema): FlagSource;

/**
 * The sole error type thrown by the library. Every throwable code path
 * converges through `FlagsError` so consumers can write a single
 * `catch (err) { if (FlagsError.is(err)) ... }` branch.
 */
export { FlagsError } from './errors/index.js';

/** Re-exported for callers who want to compose sources manually. */
export { composeSources } from './sources/compose/index.js';

export type {
  // Configuration
  DefineFlagsConfig,
  CreateFlagsConfig,
  // Handle
  FlagsHandle,
  FlagsHandleConfig,
  FlagsListener,
  // Schema + flag specs
  FlagSchema,
  FlagSpec,
  FlagKind,
  FlagValueOf,
  FlagKeysOf,
  // Context
  EvaluationContext,
  Subject,
  // Rules
  Rule,
  RuleGroup,
  Matcher,
  Operator,
  // Result
  EvaluationResult,
  EvaluationReason,
  // Sources
  FlagSource,
  FlagSourceSnapshot,
  FlagSourceSubscribeOptions,
  // Observability
  OnEvaluation,
  EvaluationEvent,
  // Misc
  Environment,
  Json,
} from './types/index.js';
```

The key design choice here is a **two-tier API**:

- `defineFlags<T>()` — **for the 95 % case** where the schema is a TS
  literal in the source tree. Full autocomplete on `get('...')`, full
  type narrowing on the return value.
- `createFlags(config)` — **for the dynamic 5 %** (JSON-loaded schemas,
  CMS-driven flags, REPL exploration). Same runtime, weaker types.

`defineFlags` is a 4-LOC wrapper around `createFlags` that exists purely
so TypeScript can infer the schema literal. Users never need to reach for
`createFlags` until they're doing something genuinely dynamic — and at
that point, the codegen CLI restores the strong-typed call sites.

### 2.2 Result + reason shape

```ts
/**
 * The outcome of a single `flags.get()` call. `value` is typed to the
 * declared `FlagKind` of the flag (when reached via `defineFlags`); the
 * remaining fields are diagnostic — surface them in dev tooling, ship
 * them to observability hooks, log them in unexpected branches.
 */
export interface EvaluationResult<TValue = unknown> {
  /** The final value chosen by the evaluation pipeline. */
  readonly value: TValue;
  /** The flag key — included so observability hooks have a self-contained payload. */
  readonly key: string;
  /** Why this value was chosen. See `EvaluationReason` enum below. */
  readonly reason: EvaluationReason;
  /**
   * The matched rule's `id` (when present) — useful for analytics
   * dashboards that bucket users by which rule fired.
   */
  readonly ruleId?: string;
  /**
   * Bucket integer in `[0, 10000)` — populated only when a rollout was
   * applied. Rendering it in dev tooling makes it obvious why a given
   * subject is or isn't in the bucket.
   */
  readonly bucket?: number;
  /** Whether the value came from defaults / overlay / remote. */
  readonly source: 'defaults' | 'json' | 'env' | 'remote' | 'compose' | 'override';
  /**
   * `true` when the result is being served from a stale snapshot because
   * a remote source failed its last refresh. Consumers can render
   * "approximate" badges in dev tools.
   */
  readonly degraded: boolean;
}

/**
 * Discriminator for *why* a value was selected. Stable across versions —
 * additions are non-breaking; renames are breaking.
 */
export type EvaluationReason =
  | 'STATIC'              // came straight from the default
  | 'ENVIRONMENT'         // an environment override applied
  | 'TARGETING_MATCH'     // a targeting rule matched
  | 'TARGETING_FALLBACK'  // rules existed but none matched
  | 'ROLLOUT_INCLUDED'    // the subject's bucket fell inside the rollout
  | 'ROLLOUT_EXCLUDED'    // the subject's bucket fell outside the rollout
  | 'OVERRIDE'            // a per-call override (testing) was applied
  | 'STALE'               // remote source failed; serving last-known
  | 'ERROR';              // pipeline aborted; default returned
```

### 2.3 Handle surface

```ts
/**
 * The runtime handle returned by `defineFlags` / `createFlags`. The full
 * generic form (`FlagsHandle<TSchema>`) is what `defineFlags` returns;
 * `createFlags` returns the un-narrowed `FlagsHandle` (which is just
 * `FlagsHandle<FlagSchema>` — `get()` widens to `unknown`).
 */
export interface FlagsHandle<TSchema extends FlagSchema = FlagSchema> {
  /**
   * Resolve a flag's value. Returns the declared kind's value type:
   *   `boolean` flag → `Promise<boolean>`
   *   `number`  flag → `Promise<number>`
   *   `string`  flag → `Promise<string>`     (or the union literal when
   *                                           the spec declares `values`)
   *   `json`    flag → `Promise<Json>`       (or the inferred shape when
   *                                           the spec declares `schema`)
   *
   * Why a `Promise` even though most lookups are synchronous? The first
   * call may `await` the lazy initial fetch of every async source
   * (remote / fs.read for JSON-from-path). Subsequent calls always
   * resolve in the same microtask. We return `Promise` unconditionally
   * to keep the public API monomorphic and so async sources are
   * never an opt-in.
   *
   * Never throws. Failures degrade to the static default and emit
   * `reason: 'ERROR'` through the observability hook.
   *
   * @param key     The flag key. Strongly typed against `TSchema`.
   * @param context Optional evaluation context. When the same handle is
   *                used across requests, the caller MUST pass a fresh
   *                context per call so targeting + rollouts work — the
   *                handle never caches the context.
   */
  get<K extends FlagKeysOf<TSchema>>(
    key: K,
    context?: EvaluationContext,
  ): Promise<FlagValueOf<TSchema, K>>;

  /**
   * Resolve every flag in the schema for a given context. Useful for
   * SSR bootstrap payloads ("hydrate the React tree with all flags
   * already evaluated"). Results are returned as a fresh frozen object;
   * subsequent mutations to the handle do not affect already-returned
   * snapshots.
   */
  getAll(context?: EvaluationContext): Promise<FlagValuesOf<TSchema>>;

  /**
   * Same as `get()` but returns the full `EvaluationResult` rather than
   * the bare value. Use this when you need `reason` / `ruleId` / `bucket`
   * for dashboards or debugging.
   */
  peek<K extends FlagKeysOf<TSchema>>(
    key: K,
    context?: EvaluationContext,
  ): Promise<EvaluationResult<FlagValueOf<TSchema, K>>>;

  /**
   * Subscribe to source changes (file watch / remote poll / SSE).
   * Listener receives the new merged snapshot. Returns an unsubscribe
   * function. SSR adapters use this to invalidate cached responses on
   * the server when a flag flips.
   */
  subscribe(listener: FlagsListener): () => void;

  /**
   * Force a refresh of every async source. Returns the new snapshot.
   * Common use cases: a webhook from your config service, a manual
   * "refresh" button in admin tooling, a test harness.
   */
  reload(): Promise<FlagSourceSnapshot>;

  /**
   * Tear down all subscriptions (file watchers, remote pollers, SSE
   * connections). Idempotent; safe to call multiple times. Most server
   * processes never call this (handle lives for the process lifetime);
   * Next.js dev workers call it on HMR boundary unmount.
   */
  dispose(): Promise<void>;

  /**
   * Frozen, normalised configuration the handle was constructed with.
   * Read-only; exposed for observability and adapters.
   */
  readonly config: Readonly<FlagsHandleConfig<TSchema>>;

  /**
   * The current merged snapshot. Useful when you need synchronous
   * access in code paths where awaiting `get()` is impractical (e.g.
   * a render-loop early in a React reconciler).
   */
  snapshot(): FlagSourceSnapshot;
}

export type FlagsListener = (snapshot: FlagSourceSnapshot) => void;
```

### 2.4 Evaluation context

```ts
/**
 * The per-request payload that drives targeting + bucketing. Construct
 * a fresh one per evaluation — the handle is **stateless** with respect
 * to context. Anonymous reads (no subject) skip rollouts entirely; this
 * is by design — see §9.3.
 */
export interface EvaluationContext {
  /**
   * The user/account/tenant the evaluation is for. The `id` is the only
   * required field; everything else is for targeting rules.
   */
  subject?: Subject;
  /**
   * Override the active environment for this single call. Tests use this
   * to assert per-environment behaviour without instantiating multiple
   * handles. NOT recommended for production code paths.
   */
  environment?: Environment;
  /**
   * Per-call overrides. The most common use is `{ flagKey: value }` in
   * tests; the override skips every other rule and surfaces
   * `reason: 'OVERRIDE'`. Production code should rely on environment
   * overrides instead.
   */
  overrides?: Record<string, unknown>;
}

export interface Subject {
  /**
   * Stable identifier — user ID, tenant ID, anonymous-cookie-ID. The
   * value drives rollout bucketing; rotating it across requests for the
   * same user defeats consistent hashing. For logged-out users, write
   * a UUID into a cookie on first hit and pass that here.
   */
  id: string;
  /**
   * Free-form attributes consulted by targeting rules. Matchers receive
   * `attributes[op.attr]`; missing attributes always *fail* the match
   * (with the documented exception of `exists`). Values must be
   * `Jsonable` — primitives, arrays, plain objects.
   */
  attributes?: Record<string, Json>;
}
```

### 2.5 Flag specs (the schema)

```ts
/**
 * The declarative shape of a single flag. The schema is a
 * `Record<string, FlagSpec>` — each entry is one of four discriminated
 * variants by `kind`. The discriminant carries through to:
 *   - `get(key)`'s return type
 *   - the legal shape of `default`, `environments`, `rules[i].value`
 *   - the legal shape of `rollout.variants` (string-flags only)
 *
 * Authoring is ergonomic: `{ kind: 'boolean', default: false }` is the
 * minimum; every other field is optional.
 */
export type FlagSpec =
  | BooleanFlagSpec
  | StringFlagSpec
  | NumberFlagSpec
  | JsonFlagSpec;

interface BaseFlagSpec<TKind extends FlagKind, TValue> {
  /** Discriminator — `'boolean' | 'string' | 'number' | 'json'`. */
  readonly kind: TKind;
  /** Optional human description; surfaced in `flags audit` reports. */
  readonly description?: string;
  /** Per-environment override map. Keys are environment names. */
  readonly environments?: Readonly<Record<string, TValue>>;
  /**
   * Targeting rules walked in order. The first matching rule wins; if
   * none match, the default is returned. Rules CAN themselves carry a
   * `rollout` so you can target a segment AND ramp the segment.
   */
  readonly rules?: ReadonlyArray<Rule<TValue>>;
  /** Default rollout applied when no rule matched. */
  readonly rollout?: Rollout<TValue>;
  /** Lifecycle markers consumed by `flags lint` / `flags audit`. */
  readonly tags?: readonly string[];
  /** Mark a flag as deprecated to make `flags lint` surface it. */
  readonly deprecated?: boolean;
}

export interface BooleanFlagSpec extends BaseFlagSpec<'boolean', boolean> {
  readonly default: boolean;
}

export interface StringFlagSpec<TValues extends string = string>
  extends BaseFlagSpec<'string', TValues> {
  readonly default: TValues;
  /**
   * Optional finite set of allowed values — when present, `default` and
   * every rule value must be assignable to one of them, and the
   * resolved value is typed as the literal union `TValues`. Multivariate
   * rollouts (`rollout.variants`) are typed against this union too.
   */
  readonly values?: readonly TValues[];
}

export interface NumberFlagSpec extends BaseFlagSpec<'number', number> {
  readonly default: number;
  /** Optional inclusive `[min, max]` clamp applied at coercion time. */
  readonly range?: readonly [number, number];
}

export interface JsonFlagSpec<TShape = Json> extends BaseFlagSpec<'json', TShape> {
  readonly default: TShape;
  /**
   * Optional Standard-Schema-V1-compatible validator (e.g. a Zod schema).
   * When present, every JSON-coerced value is validated against it on
   * the first read; failure falls back to `default` and emits
   * `reason: 'ERROR'` through the observability hook. Standard Schema
   * is detected duck-typed (`schema['~standard']`) so no runtime dep on
   * Zod / Valibot / Arktype.
   */
  readonly schema?: StandardSchemaV1<TShape>;
}
```

### 2.6 Rules

```ts
/**
 * A targeting rule = a guard (`when`) plus an outcome. The outcome may
 * be a fixed `value`, a `rollout`, or both (a rollout *within* a
 * matched segment).
 */
export interface Rule<TValue = unknown> {
  /** Stable identifier for analytics ("which rule fired?"). Optional. */
  readonly id?: string;
  /** Human description for dashboards. */
  readonly description?: string;
  /**
   * The match condition. When omitted (rare; only for "always-match"
   * fallback rules) the rule fires for every context.
   */
  readonly when?: RuleGroup;
  /**
   * The value returned when the rule matches. Mutually exclusive with
   * `rollout` — pass exactly one. If neither is supplied the rule is
   * a no-op (fires but returns the default), useful for analytics-only
   * rules that just observe a segment.
   */
  readonly value?: TValue;
  /**
   * Apply a rollout *within* the matched segment. The rollout's
   * `subjectId` defaults to the handle-level extractor. Bucketing salt
   * is `(handle.salt, flagKey, ruleId)` so two rules in the same flag
   * produce independent buckets.
   */
  readonly rollout?: Rollout<TValue>;
}

/**
 * Boolean composition of matchers. The default is implicit-AND when an
 * object map is given; explicit `$and` / `$or` / `$not` keys nest.
 */
export type RuleGroup =
  | { readonly $and: readonly RuleGroup[] }
  | { readonly $or: readonly RuleGroup[] }
  | { readonly $not: RuleGroup }
  | Readonly<Record<string, Matcher>>;  // implicit AND across attrs

/** A single attribute matcher. Operators see attribute by key. */
export type Matcher =
  | { readonly eq: Json }
  | { readonly neq: Json }
  | { readonly in: readonly Json[] }
  | { readonly nin: readonly Json[] }
  | { readonly gt: number | string }
  | { readonly gte: number | string }
  | { readonly lt: number | string }
  | { readonly lte: number | string }
  | { readonly regex: string; readonly flags?: string }
  | { readonly contains: string }
  | { readonly startsWith: string }
  | { readonly endsWith: string }
  | { readonly exists: boolean }
  | { readonly custom: (value: Json | undefined) => boolean };

export type Operator =
  | 'eq' | 'neq' | 'in' | 'nin'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'regex' | 'contains' | 'startsWith' | 'endsWith'
  | 'exists' | 'custom';
```

### 2.7 Rollouts

```ts
/**
 * Percentage rollout. The simplest form is `{ percentage: N }` — bucket
 * 0..N enables, the rest disables (for boolean flags) or returns the
 * spec's default (for value flags).
 *
 * For string flags with `values: ['a','b','c']`, a multivariate rollout
 * is `{ variants: { a: 50, b: 30, c: 20 } }`; weights MUST sum to 100.
 *
 * Bucketing is deterministic: `bucket = FNV-1a(salt + flagKey + subjectId) % 10000`.
 * Increasing `percentage` from 25 → 50 means every subject already in the
 * 25 % segment stays in (their bucket didn't move). Rotating the salt
 * reshuffles every subject — see §9.4.
 */
export type Rollout<TValue = unknown> =
  | {
      /** Inclusive percent in `[0, 100]`. `100` = always-on. */
      readonly percentage: number;
      /**
       * Override the default subject extractor for this single rollout.
       * Useful when a rule wants to bucket by, e.g., `tenantId` instead
       * of the user's `id`.
       */
      readonly subjectId?: (ctx: EvaluationContext) => string;
    }
  | {
      /** Multivariate rollout: each variant's weight is its percentage. */
      readonly variants: Readonly<Record<string, number>>;
      readonly subjectId?: (ctx: EvaluationContext) => string;
    };
```

### 2.8 Sources (subpath imports)

#### 2.8.1 `@devkit/flags/sources/json`

```ts
/**
 * Load a flags overlay from JSON. Three input forms:
 *
 *   1. **Path**     `createJsonSource('./flags.json')`
 *      Resolved relative to `process.cwd()` on Node-like runtimes.
 *      With `{ watch: true }`, hot-reloads via `node:fs.watch` (Node /
 *      Bun) — silently no-ops on Workers / Deno Deploy / browser.
 *
 *   2. **URL**      `createJsonSource(new URL('https://cdn.example.com/flags.json'))`
 *      Fetched once on first read. For polling, use `createRemoteSource`.
 *
 *   3. **Object**   `createJsonSource({ flags: { newCheckout: true } })`
 *      Inline literal — handy for tests.
 *
 *   4. **Function** `createJsonSource(() => readFlagsFromCms())`
 *      Returning any of the above; called every reload.
 *
 * @example
 *   import { createJsonSource } from '@devkit/flags/sources/json';
 *
 *   const flags = defineFlags({
 *     flags: { newCheckout: { kind: 'boolean', default: false } },
 *     sources: [createJsonSource('./flags.json', { watch: true })],
 *   });
 */
export function createJsonSource(
  input: string | URL | FlagsJson | (() => Promise<FlagsJson | string | URL> | FlagsJson | string | URL),
  opts?: {
    /** Enable `node:fs.watch` (Node + Bun only). Default: `false`. */
    watch?: boolean;
    /** Encoding when reading from disk. Default: `'utf8'`. */
    encoding?: 'utf8' | 'utf-8';
  },
): FlagSource;

/**
 * The on-disk JSON shape. Strict — the parser rejects unknown
 * top-level keys to surface typos as errors rather than silent ignores.
 */
export interface FlagsJson {
  $schema?: string; // optional reference to our published JSON schema
  flags: Record<string, FlagJsonEntry>;
  environments?: string[];
}

export type FlagJsonEntry =
  | { kind: 'boolean'; default: boolean; environments?: Record<string, boolean>; rules?: RuleJson[]; rollout?: RolloutJson; tags?: string[]; deprecated?: boolean; description?: string }
  | { kind: 'string';  default: string;  values?: string[]; environments?: Record<string, string>; rules?: RuleJson[]; rollout?: RolloutJson; tags?: string[]; deprecated?: boolean; description?: string }
  | { kind: 'number';  default: number;  range?: [number, number]; environments?: Record<string, number>; rules?: RuleJson[]; rollout?: RolloutJson; tags?: string[]; deprecated?: boolean; description?: string }
  | { kind: 'json';    default: Json;    environments?: Record<string, Json>; rules?: RuleJson[]; rollout?: RolloutJson; tags?: string[]; deprecated?: boolean; description?: string };
```

#### 2.8.2 `@devkit/flags/sources/env`

```ts
/**
 * Read flag overrides from environment variables. The key transform is
 * `flagKey ('newCheckout')` → `${prefix}NEW_CHECKOUT` (camelCase splits
 * on capital letters; consecutive caps stay together). Values are
 * coerced based on the flag's declared `kind`:
 *
 *   - `boolean` → `'true' | '1' | 'on' | 'yes'` (case-insensitive)
 *                 maps to `true`; everything else → `false`.
 *   - `number`  → `Number(v)`; `NaN` → falls back to default + ERROR.
 *   - `string`  → raw value.
 *   - `json`    → `JSON.parse(v)`; on failure → default + ERROR.
 *
 * Reads `process.env` (Node / Bun) or `Deno.env.toObject()` (Deno) via
 * the central `runtime` probe. On Cloudflare Workers there are no
 * environment variables in `globalThis`; consumers must pass an
 * explicit `env` object via `opts.env`.
 *
 * @example
 *   import { createEnvSource } from '@devkit/flags/sources/env';
 *
 *   defineFlags({
 *     flags: { newCheckout: { kind: 'boolean', default: false } },
 *     sources: [createEnvSource()],
 *   });
 *
 *   // FLAG_NEW_CHECKOUT=true → flags.get('newCheckout') === true
 *
 * @example  Workers
 *   defineFlags({
 *     // ...
 *     sources: [createEnvSource({ env })], // env from `fetch(req, env)`
 *   });
 */
export function createEnvSource(opts?: {
  /** Variable prefix. Default: `'FLAG_'`. Set `''` to disable prefixing. */
  prefix?: string;
  /** Explicit env bag — required on Cloudflare Workers; auto-detected elsewhere. */
  env?: Record<string, string | undefined>;
  /** Override the camelCase → SCREAMING_SNAKE transform. */
  toEnvVarName?: (flagKey: string) => string;
}): FlagSource;
```

#### 2.8.3 `@devkit/flags/sources/remote`

```ts
/**
 * Periodically fetch a JSON snapshot from a URL. Designed for use
 * against:
 *   - A static JSON file behind a CDN (S3 + CloudFront, Cloudflare R2,
 *     Vercel Edge Config public route).
 *   - Your own admin service `/api/flags`.
 *   - PostHog / GrowthBook / Unleash exports re-formatted to our schema.
 *
 * The first read awaits the initial fetch (consumers may want this to
 * succeed before serving traffic — call `await flags.reload()` once at
 * boot if you need a hard guarantee). Subsequent reads always hit the
 * frozen snapshot — never the network.
 *
 * Uses `If-None-Match` + 304 handling so polling against a CDN is
 * essentially free. With `transport: 'sse'`, subscribes to a Server-
 * Sent Events stream instead of polling — the connection is restarted
 * with exponential back-off on disconnect, capped at 30 s.
 */
export function createRemoteSource(
  url: string | URL,
  opts?: {
    /** Polling cadence; ignored when `transport === 'sse'`. Default: `60_000`. */
    pollInterval?: number;
    /** `'poll'` (default) or `'sse'`. */
    transport?: 'poll' | 'sse';
    /** Custom `fetch` (e.g. wrapped with auth). Default: `globalThis.fetch`. */
    fetch?: typeof fetch;
    /** Default request init applied to every poll. Use for auth headers. */
    init?: RequestInit;
    /**
     * Maximum payload size in bytes. Default: 64 KiB. Larger payloads
     * are rejected with `FlagsError('PAYLOAD_TOO_LARGE')` — the source
     * keeps serving its previous snapshot.
     */
    maxBytes?: number;
    /** Times-out individual fetches. Default: 5 s. */
    requestTimeoutMs?: number;
    /** Back-off for transient errors. Default: exponential, base 1s, cap 30s. */
    backoff?: BackoffStrategy;
  },
): FlagSource;
```

#### 2.8.4 `@devkit/flags/sources/compose`

```ts
/**
 * Overlay multiple sources in priority order. Later sources win per
 * flag key (object-shallow merge — a remote source providing
 * `{ rules: [...] }` REPLACES, not merges, a JSON source's `rules`).
 *
 * Most consumers don't reach for this directly — passing
 * `sources: [a, b, c]` to `defineFlags` calls `composeSources` for
 * you. Reach for it when you want a non-default merge order or
 * when wrapping a single composed source as a sub-component of a
 * larger source array.
 */
export function composeSources(
  sources: readonly FlagSource[],
  opts?: {
    /**
     * Override the default object-shallow per-flag merge with a custom
     * combiner. The combiner is called once per flag key, with the
     * sequence of seen `FlagSpec` values across all sources.
     */
    merge?: (key: string, layers: readonly FlagSpec[]) => FlagSpec;
  },
): FlagSource;
```

### 2.9 Framework adapters (subpath imports)

Each adapter is paper-thin — its job is to surface the same handle
through the framework's idiomatic primitives (Context, hook, middleware,
plugin) and to wire SSR / RSC streaming correctly. None of them re-export
core types; consumers import shared types from the root `@devkit/flags`.

#### 2.9.1 `@devkit/flags/adapters/react`

```ts
/**
 * React adapter — provider + hooks. SSR-safe via `useSyncExternalStore`;
 * concurrent-mode safe; works in RSC client components.
 */
export function FlagsProvider<S extends FlagSchema>(props: {
  flags: FlagsHandle<S>;
  /** Per-render evaluation context. Memoise upstream to avoid resub. */
  context?: EvaluationContext;
  /** Optional initial snapshot for SSR hydration. */
  initialSnapshot?: FlagSourceSnapshot;
  children: React.ReactNode;
}): JSX.Element;

/** Read a flag's resolved value reactively. */
export function useFlag<S extends FlagSchema, K extends FlagKeysOf<S>>(
  key: K,
  fallback?: FlagValueOf<S, K>,
): FlagValueOf<S, K>;

/** Read full evaluation result (reason / bucket / ruleId). */
export function useFlagResult<S extends FlagSchema, K extends FlagKeysOf<S>>(
  key: K,
): EvaluationResult<FlagValueOf<S, K>>;

/** Read every flag at once. Use sparingly — re-renders on any flip. */
export function useFlags<S extends FlagSchema>(): FlagValuesOf<S>;

/** Render-prop / declarative form. */
export function Flag<S extends FlagSchema, K extends FlagKeysOf<S>>(props: {
  name: K;
  children: FlagValueOf<S, K> | ((value: FlagValueOf<S, K>) => React.ReactNode);
  fallback?: React.ReactNode;
}): JSX.Element;
```

#### 2.9.2 `@devkit/flags/adapters/next`

```ts
/**
 * Next.js App Router. The `getFlag` helper is wrapped in `cache()` so
 * RSC trees evaluate every flag at most once per request. The middleware
 * extracts a stable subject ID from cookies and sets a header for
 * downstream handlers to read.
 */
export function createFlagsRoute<S extends FlagSchema>(
  flags: FlagsHandle<S>,
): (req: NextRequest) => Response | Promise<Response>;

export function getFlag<S extends FlagSchema, K extends FlagKeysOf<S>>(
  flags: FlagsHandle<S>,
  key: K,
): Promise<FlagValueOf<S, K>>;

export function flagsMiddleware<S extends FlagSchema>(
  flags: FlagsHandle<S>,
  opts?: {
    cookieName?: string;
    headerName?: string;
    extractSubject?: (req: NextRequest) => Subject | undefined;
  },
): (req: NextRequest) => NextResponse;
```

#### 2.9.3 `@devkit/flags/adapters/sveltekit`

```ts
export function flagsHandle<S extends FlagSchema>(
  flags: FlagsHandle<S>,
  opts?: { extractSubject?: (event: RequestEvent) => Subject | undefined },
): Handle;
```

#### 2.9.4 `@devkit/flags/adapters/vue`

```ts
export function createFlagsPlugin<S extends FlagSchema>(
  flags: FlagsHandle<S>,
): Plugin;

export function useFlag<S extends FlagSchema, K extends FlagKeysOf<S>>(
  key: K,
): Ref<FlagValueOf<S, K>>;
```

#### 2.9.5 `@devkit/flags/adapters/hono`

```ts
export function honoFlags<S extends FlagSchema, E extends Env = Env>(
  flags: FlagsHandle<S>,
  opts?: { extractSubject?: (c: Context<E>) => Subject | undefined },
): MiddlewareHandler<E & { Variables: { flags: FlagsHandle<S>; flag: <K extends FlagKeysOf<S>>(key: K) => Promise<FlagValueOf<S, K>> } }>;
```

#### 2.9.6 `@devkit/flags/adapters/express`

```ts
export function expressFlags<S extends FlagSchema>(
  flags: FlagsHandle<S>,
  opts?: { extractSubject?: (req: Request) => Subject | undefined },
): RequestHandler; // adds req.flag(key) and req.flags
```

#### 2.9.7 `@devkit/flags/adapters/openfeature`

```ts
/**
 * Returns an OpenFeature `Provider` so consumers can plug @devkit/flags
 * into the standard CNCF SDK. Reasons translate to OpenFeature's
 * `ResolutionReason` (TARGETING_MATCH → TARGETING_MATCH; ROLLOUT_*
 * → SPLIT; STATIC → DEFAULT, etc).
 */
export function createOpenFeatureProvider<S extends FlagSchema>(
  flags: FlagsHandle<S>,
): Provider; // type from @openfeature/server-sdk peer dep
```

### 2.10 Observability — `@devkit/flags/observe`

```ts
/**
 * Hook signature. Fires once per `get()` / `peek()` call (after
 * coercion, before the public Promise resolves). Errors thrown inside
 * the hook are caught + console.error'd; they NEVER propagate.
 */
export type OnEvaluation = (event: EvaluationEvent) => void | Promise<void>;

export interface EvaluationEvent {
  readonly flagKey: string;
  readonly value: unknown;
  readonly reason: EvaluationReason;
  readonly ruleId?: string;
  readonly bucket?: number;
  readonly subject?: Subject;
  readonly environment: string;
  readonly elapsedMs: number; // measured between dispatch and resolve
  readonly timestamp: number; // Date.now() at resolve
}

/** Pre-built taps for popular analytics platforms. */
export function toConsole(level?: 'log' | 'debug' | 'info'): OnEvaluation;
export function toPostHog(client: { capture: (e: { event: string; properties: Record<string, unknown>; distinctId?: string }) => void }): OnEvaluation;
export function toEndpoint(url: string, opts?: { batchSize?: number; flushIntervalMs?: number; fetch?: typeof fetch }): OnEvaluation;
```

### 2.11 CLI

```
$ flags codegen   --in ./flags.json --out ./src/flags.generated.ts
$ flags lint      --in ./flags.json --src "./src/**/*.{ts,tsx}"
$ flags audit     --in ./flags.json --src "./src/**/*.{ts,tsx}"
                                    [--json]
```

The CLI is exposed via `package.json#bin`. Every subcommand is a single
file under `src/cli/`, parses arguments via a 50-LOC vendored parser
(no `commander` / `yargs` dep), and writes plain text to stdout
(or JSON when `--json` is passed).

---

## 3. Internal Architecture

```
                       ┌─────────────────────────────┐
                       │ defineFlags<T>(config)      │  ← user code
                       └────────────┬────────────────┘
                                    │ (literal-typed)
                                    ▼
                       ┌─────────────────────────────┐
                       │ createFlags(config)         │  ← runtime factory
                       └────────────┬────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────────────┐
              │                     │                             │
              ▼                     ▼                             ▼
    defaultsSource(schema)    sources: [json,env,remote]    onEvaluation hook
              │                     │                             │
              └─────────┬───────────┘                             │
                        ▼                                         │
                composeSources()                                  │
                        │                                         │
                        ▼                                         │
                 Snapshot (frozen)  ◀───── reload() / file watch / poll / SSE
                        │                                         │
                        ▼                                         │
                   FlagsHandle                                    │
                        │                                         │
        ┌───────────────┼─────────────────────────────────┐       │
        │               │                                 │       │
        ▼               ▼                                 ▼       │
     get(k,ctx)    getAll(ctx)                         peek(k,ctx)│
        │               │                                 │       │
        └───────┬───────┴────────────────────┬────────────┘       │
                ▼                            ▼                    │
        evaluateFlag(spec, ctx, env)         │                    │
                │                            │                    │
        ┌───────┼───────────────────────┐    │                    │
        ▼       ▼                       ▼    ▼                    │
     env-       rules.ts → matchers    rollout/bucket             │
     override   (recursive AND/OR/NOT)  (FNV-1a)                   │
        │       │                       │                          │
        └───────┴──────────┬────────────┘                          │
                           ▼                                       │
                       coerce.ts                                   │
                           │                                       │
                           └──── EvaluationResult ─────────────────┘
                                                                   │
                                                                   ▼
                                                          observability fan-out
```

### 3.1 The single evaluation pipeline

`src/core/evaluate.ts` is the only function that knows the full
sequencing. Its body is roughly:

```ts
function evaluateFlag(
  spec: FlagSpec,
  context: EvaluationContext,
  config: NormalisedConfig,
): EvaluationResult {
  const env = context.environment ?? config.environment;

  // 0. per-call override (testing, or environment.overrides)
  const override = context.overrides?.[spec.key] ?? config.overrides?.[spec.key];
  if (override !== undefined) {
    return finalize(coerce(override, spec.kind), 'OVERRIDE', spec, ...);
  }

  // 1. environment override
  const envValue = spec.environments?.[env];

  // 2. rules walk
  if (spec.rules) {
    for (const rule of spec.rules) {
      if (rule.when && !matchRule(rule.when, context)) continue;
      // matched
      if (rule.rollout) {
        const decision = bucketFor(config.salt, spec.key + ':' + rule.id, ...);
        if (decision.included) {
          return finalize(decision.value, 'ROLLOUT_INCLUDED', ..., rule.id, decision.bucket);
        }
        // fall-through to next rule on rollout exclusion
      }
      if (rule.value !== undefined) {
        return finalize(rule.value, 'TARGETING_MATCH', ..., rule.id);
      }
    }
    // rules existed but none matched
    if (envValue !== undefined) return finalize(envValue, 'ENVIRONMENT', ...);
    if (spec.rollout)            return applyRollout(spec.rollout, ...);
    return finalize(spec.default, 'TARGETING_FALLBACK', ...);
  }

  // 3. flag-level rollout
  if (spec.rollout) return applyRollout(spec.rollout, context, env, ...);

  // 4. environment override beats default
  if (envValue !== undefined) return finalize(envValue, 'ENVIRONMENT', ...);

  // 5. static default
  return finalize(spec.default, 'STATIC', ...);
}
```

Key invariants:

- **Pure**. No side effects (the observability hook is fanned out from
  the calling site, not from inside `evaluateFlag`).
- **Never throws**. Every error path returns a `Result` with
  `reason: 'ERROR'` and the static default; the hook receives the
  thrown error in `event.error` for diagnosis.
- **Order is documented and CI-tested**. Reordering steps would change
  semantics for users — every reordering candidate has a regression test
  in `test/correctness/`.

### 3.2 Snapshot tear-protection

Source updates (file watch, remote poll, SSE message) build a fresh,
frozen `Snapshot` object and atomically swap the handle's reference. An
in-flight `evaluateFlag` call captured the snapshot at entry and is
unaffected by the swap — readers never observe a half-merged state. The
snapshot itself is `Object.freeze`d transitively (one level — flag specs
are frozen at construction, never mutated), guaranteeing no caller can
mutate it.

### 3.3 Async source initial-load coordination

The first call to `flags.get()` triggers a single in-flight initial
fetch shared by every concurrent caller. We use the tiny `once.ts`
helper:

```ts
const initialise = once(async () => {
  const snapshots = await Promise.all(sources.map(s => s.load()));
  return composeSnapshots(snapshots);
});
```

`once()` returns the same Promise to every concurrent caller, then
caches the resolved snapshot. Subsequent reloads bypass `once()` and
build a fresh snapshot directly — only the *first* load is coalesced.

### 3.4 Hot-reload propagation

A source that supports hot-reload (JSON `watch: true`, remote
`pollInterval`, SSE) calls `subscribe(listener)` on construction. When
the listener fires, the handle:

1. Builds a new merged snapshot from every source's current data.
2. Atomically swaps `this.snapshot`.
3. Fans out to every external `subscribe(listener)` registration.

React / Svelte adapters wire those external subscriptions through
`useSyncExternalStore` / `writable` so component trees re-render
without polling.

### 3.5 Bucketing algorithm

```
bucket = FNV-1a-32(salt + ':' + flagKey + ':' + subjectId) % 10_000
```

The 10 000-bucket precision (vs naïve `%100`) lets consumers ramp by
0.01 % increments — useful for high-traffic services where a 1 %
change is still 100 RPS of new exposure. The FNV-1a constants live in
`hash.ts` and are inlined by tsup at minify time.

For multivariate rollouts:

```
weights:    {a: 50, b: 30, c: 20}
cumulative: [50, 80, 100]   // pre-computed at config normalisation
bucket:     7531  → /100 = 75.31 → variant 'b'
```

The `subjectId` defaults to `ctx.subject?.id ?? ''`; **anonymous
subjects always hash to the same bucket** (`FNV-1a('salt::flag:')`),
so they all flip together. This is intentional — see §9.3.

---

## 4. Type System

The library's headline feature is **compile-time type-safety on flag
keys + values**, paid for entirely at the type level — zero bytes of
runtime cost. The core mechanism is a single mapped-type lookup:

```ts
// Internal — the raw shape passed by the user.
export type FlagSchema = Record<string, FlagSpec>;

// "Literal-mode" inference: when `defineFlags` receives an object
// literal, TS infers each entry's `kind` as the literal `'boolean'`
// (NOT widened to `string`) and each `default` as the literal value
// (NOT widened to `boolean`). The DefineFlagsConfig generic propagates
// that literal information through.
export interface DefineFlagsConfig<TSchema extends FlagSchema> {
  flags: TSchema;
  environment?: Environment;
  sources?: readonly FlagSource[];
  subjectId?: (ctx: EvaluationContext) => string;
  salt?: string;
  onEvaluation?: OnEvaluation;
}

// The big mapped-type: given a FlagSpec, produce its declared value type.
export type FlagValueOf<TSchema extends FlagSchema, TKey extends keyof TSchema> =
  TSchema[TKey] extends BooleanFlagSpec       ? boolean
  : TSchema[TKey] extends StringFlagSpec<infer V> ? V
  : TSchema[TKey] extends NumberFlagSpec      ? number
  : TSchema[TKey] extends JsonFlagSpec<infer J>   ? J
  : never;

export type FlagKeysOf<TSchema extends FlagSchema> = keyof TSchema & string;

export type FlagValuesOf<TSchema extends FlagSchema> = {
  readonly [K in FlagKeysOf<TSchema>]: FlagValueOf<TSchema, K>;
};
```

### 4.1 Why `defineFlags` is a function and not a const

`defineFlags<T>()` is a generic function so that TypeScript can infer
`T` from its argument's literal types. If we shipped the raw schema as
a `const` object, TS would widen `default: false` to `boolean` and
swallow the literal inference we need for `StringFlagSpec.values`'s
union narrowing.

### 4.2 String-flag union narrowing

```ts
const flags = defineFlags({
  flags: {
    variant: {
      kind: 'string',
      default: 'control',
      values: ['control', 'A', 'B'] as const,
    },
  },
});

const v = await flags.get('variant');
//    ^? const v: 'control' | 'A' | 'B'
```

This is achieved through the `StringFlagSpec<TValues extends string>`
generic and the conditional `infer V` in `FlagValueOf`. The `as const`
on the `values` array is the only ergonomic tax — Biome ships a
codemod that adds it automatically.

### 4.3 JSON-flag shape inference

```ts
const flags = defineFlags({
  flags: {
    pricing: {
      kind: 'json',
      default: { plan: 'pro', seats: 5 } as { plan: 'free' | 'pro'; seats: number },
    },
  },
});

const p = await flags.get('pricing');
//    ^? const p: { plan: 'free' | 'pro'; seats: number }
```

For projects already using Zod / Valibot / Arktype, pass a
Standard-Schema-V1-compatible validator via `schema` — its inferred
output type drives `FlagValueOf` automatically.

### 4.4 Generic propagation through adapters

Every adapter accepts `FlagsHandle<S>` generically and threads `S` into
its hooks / middleware:

```ts
const flags = defineFlags({ /* ... */ });

function MyComponent() {
  const v = useFlag<typeof flags extends FlagsHandle<infer S> ? S : never, 'newCheckout'>('newCheckout');
  //    ^? const v: boolean
}
```

In practice the user writes `useFlag('newCheckout')` and a tiny
`declare module` ambient (or the codegen output) re-types
`useFlag<K>(key: K)` against the literal schema, so the verbose
`typeof flags extends ...` is never user-visible.

### 4.5 Strict tsconfig

The repo turns on every strictness flag we can sustain:

| Flag | Rationale |
|---|---|
| `strict: true` | baseline |
| `noUncheckedIndexedAccess: true` | `record[k]` is `T \| undefined` — forces null-checks at attribute lookups |
| `exactOptionalPropertyTypes: true` | `x?: T` ≠ `T \| undefined`; matters when forwarding optional props |
| `noImplicitOverride: true` | every `override` must be explicit |
| `verbatimModuleSyntax: true` | `import type` discipline; CJS↔ESM clarity |
| `useUnknownInCatchVariables: true` | every `catch` narrows through `FlagsError.is` |
| `isolatedModules: true` | tsup compatibility |

### 4.6 Type tests

`test/types/inference.test-d.ts` uses `vitest --typecheck` to assert
that:

- Unknown flag keys are rejected at `get()` call sites.
- Boolean-flag `get()` resolves to `Promise<boolean>` (not
  `Promise<boolean | string | number | Json>`).
- String-flag `values` narrows the return type to the union literal.
- JSON-flag `schema` narrows the return type to the validator's output.
- Targeting `rules` with `value` are rejected at the type level when
  `value` is the wrong kind for the flag (e.g. number on a boolean flag).
- `useFlag<S, K>` rejects unknown keys when given a typed handle.

These tests run in CI on every PR.

---

## 5. Error Handling Strategy

### 5.1 Single error class

Every throwable code path converges through `FlagsError`:

```ts
export class FlagsError extends Error {
  override readonly name = 'FlagsError';
  readonly code: FlagsErrorCode;
  readonly cause?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;

  constructor(
    code: FlagsErrorCode,
    message: string,
    opts?: { cause?: unknown; context?: Record<string, unknown> },
  );

  /** Type-narrowing guard. Inside catch blocks, write `if (FlagsError.is(err))`. */
  static is(err: unknown): err is FlagsError;
}
```

### 5.2 Error codes

A finite, stable enum. Adding a code is a minor-version change;
removing or renaming a code is breaking.

| Code | Origin | Throws? | Returned via Result? |
|---|---|---|---|
| `INVALID_SCHEMA` | `defineFlags` / `createFlags` | yes (config-time) | — |
| `UNKNOWN_FLAG` | `flags.get('typo')` (non-typed handle only) | no — returns ERROR result | yes |
| `JSON_PARSE_ERROR` | `createJsonSource` | yes when path; via Result when watcher reload | yes |
| `JSON_SCHEMA_ERROR` | json-flag `schema` validation | no — falls back to default | yes |
| `TYPE_MISMATCH` | `coerce.ts` cannot coerce raw value to declared kind | no — falls back to default | yes |
| `SOURCE_LOAD_FAILED` | `createRemoteSource` initial load | yes by default; opt-in to graceful | yes when `failOpen` |
| `SOURCE_REFRESH_FAILED` | hot-reload tick | no — degraded snapshot served | yes |
| `PAYLOAD_TOO_LARGE` | remote source body | no — last snapshot served | yes |
| `OBSERVABILITY_HOOK_ERROR` | user's `onEvaluation` threw | no — `console.error`d, ignored | no |
| `RULE_EVAL_ERROR` | user's `custom` matcher threw | no — match returns `false` | yes |

### 5.3 When to throw vs return Result

- **At configuration time** — bad schema / unparseable JSON during the
  initial sync load — `defineFlags` / `createFlags` throws synchronously.
  This is by design: misconfiguration must surface during boot, not at
  the first user request.
- **At evaluation time** — every error becomes an `EvaluationResult`
  with `reason: 'ERROR'` and the static default. This guarantees that
  `flags.get()` is **safe to call from anywhere** (including a render
  hot-path) without try/catch ceremony.
- **At hot-reload time** — errors are swallowed; the previous snapshot
  is preserved and `degraded: true` is set on the next read so observers
  can detect the staleness.

### 5.4 The `cause` chain

Every wrapped error carries its `cause`. This matters for remote source
diagnostics (`fetch` → `AbortError` → `SOURCE_REFRESH_FAILED` chain) and
for OpenFeature interop (the OF spec requires propagating the underlying
error through `errorMessage`).

### 5.5 No silent string-typed errors

We never `throw new Error('something')`. Every throw site uses
`invariant(cond, 'CODE', message)` which constructs a `FlagsError`. The
Biome lint config bans `throw new Error` in `src/`.

---

## 6. Bundle & Tree-shaking Plan

### 6.1 Subpath exports map

The package ships **15 entry points** (see §8 / `package.json#exports`).
Each is built as its own tsup entry, emits its own `.js` + `.d.ts`, and
has a separate `size-limit` budget. A consumer who imports only
`@devkit/flags` gets the core engine and absolutely nothing else; the
JSON source, env source, remote source, every framework adapter, the
OpenFeature provider, the observability taps and the CLI live behind
`/sources/...`, `/adapters/...`, `/observe`, `/cli`.

| Entry | Budget |
|---|---|
| `@devkit/flags` (core) | **3 KB** |
| `@devkit/flags/errors` | 0.4 KB |
| `@devkit/flags/sources/json` | 0.7 KB |
| `@devkit/flags/sources/env` | 0.5 KB |
| `@devkit/flags/sources/remote` | 1 KB |
| `@devkit/flags/sources/compose` | 0.4 KB |
| `@devkit/flags/adapters/react` | 0.7 KB |
| `@devkit/flags/adapters/next` | 0.6 KB |
| `@devkit/flags/adapters/sveltekit` | 0.4 KB |
| `@devkit/flags/adapters/vue` | 0.5 KB |
| `@devkit/flags/adapters/hono` | 0.4 KB |
| `@devkit/flags/adapters/express` | 0.5 KB |
| `@devkit/flags/adapters/openfeature` | 1 KB |
| `@devkit/flags/observe` | 0.3 KB |

The numbers are **gzipped** byte budgets enforced in CI by
`size-limit` — a PR exceeding any budget fails the build.

### 6.2 `sideEffects: false`

`package.json` declares `"sideEffects": false`. No file in `src/`:

- Calls a function at module top-level (other than pure value
  declarations).
- Mutates a global.
- Registers a listener on `process` / `globalThis`.

Bundlers can therefore drop unimported re-exports during marking.

### 6.3 Per-file rules

- **No file imports from a sibling barrel.** The CI pipeline runs a
  Biome rule that flags `import { ... } from '../some-barrel/index.js'`
  outside of `package.json#exports` boundaries.
- **No file imports from a runtime probe.** `utils/runtime.ts` is the
  only file that reads `globalThis.process` / `Deno` / `Bun`.
- **No file imports adapter code.** Adapters import core; core never
  imports adapters.
- **No file imports CLI code.** CLI imports core; core never imports CLI.

### 6.4 Minification expectations

`tsup` with `minify: true` and `mangleProps: /^_/` shaves ~30 % off the
unminified output. Internal-only properties begin with `_` so they get
mangled to single letters; the public API has no `_`-prefixed surface.

### 6.5 dual-runtime emit

Despite `type: module`, every entry emits a single `.js` (ESM only).
Node 20+ + Bun + Deno + Workers all support ESM natively; we don't
bother with a CJS shim. Consumers on legacy Node 18 must add a
`tsx`/`tsm`-style ESM bootstrap or upgrade. Documented in README.

---

## 7. Dependencies

### 7.1 Runtime dependencies — **zero**

Pulling in **any** runtime dep blows the bundle budget and forces
consumers on edge runtimes to vet our supply chain. Everything we need
is built from scratch:

| What | Why we don't add a dep |
|---|---|
| Hashing | FNV-1a 32-bit fits in 14 LOC; keeps us deterministic across runtimes; no `crypto.subtle` async ceremony. |
| Argument parsing (CLI) | 50-LOC vendored parser handles our 6 flags; `commander`/`yargs` would be 30 KB+ each. |
| JSON schema validation | Optional via Standard Schema duck-typing — Zod / Valibot / Arktype users get full validation for free; non-users pay zero bytes. |
| Glob (CLI) | Use `node:fs/promises.glob` (Node 22+) or a 30-LOC fallback for older Nodes. |
| File watch | `node:fs.watch` directly. |
| HTTP | `globalThis.fetch` only. |
| EventSource | Use global if available, fall back to a 60-LOC `ReadableStream` parser. |
| Time | `Date.now()` + `globalThis.setInterval`. |

### 7.2 Peer dependencies (all `optional: true`)

| Peer | Used by | Notes |
|---|---|---|
| `react ^18 \|\| ^19` | `adapters/react` | hooks + `useSyncExternalStore` |
| `next ^13.4 \|\| ^14 \|\| ^15` | `adapters/next` | App Router + `cache()` |
| `@sveltejs/kit ^2` | `adapters/sveltekit` | `Handle` type |
| `vue ^3.3` | `adapters/vue` | Plugin + composable |
| `hono ^4` | `adapters/hono` | `MiddlewareHandler` type |
| `express ^4 \|\| ^5` | `adapters/express` | `RequestHandler` type |
| `@openfeature/server-sdk ^1.13` | `adapters/openfeature` | `Provider` interface |

`peerDependenciesMeta` marks every entry `optional: true` so npm doesn't
warn for users who don't use the matching adapter.

### 7.3 Dev dependencies

Standard tooling — `typescript`, `tsup`, `vitest`, `@biomejs/biome`,
`@arethetypeswrong/cli`, `publint`, `size-limit`, `@changesets/cli`,
`@cloudflare/vitest-pool-workers` (for runtime-portability tests),
`@vitest/coverage-v8`, `msw` (remote-source HTTP fixtures), `jsdom`
(React adapter tests).

---

## 8. Configuration

### 8.1 `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules"]
}
```

`tsconfig.build.json` extends with `"exclude": ["src/**/*.test.ts",
"src/**/*.test.tsx", "test"]` so the publishable `.d.ts` rollup never
contains test types.

### 8.2 `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'jsdom',
          include: ['test/adapters/react.test.tsx', 'test/adapters/vue.test.ts'],
          environment: 'jsdom',
        },
      },
      {
        test: {
          name: 'workers',
          include: ['test/runtime/workers.test.ts'],
          poolOptions: {
            workers: { wrangler: { configPath: './test/runtime/wrangler.toml' } },
          },
        },
      },
    ],
    globals: false,
    typecheck: {
      enabled: false, // toggled on with --typecheck
      include: ['test/types/**/*.test-d.ts'],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/index.ts', // public re-export barrels — counted via callers
        'src/types/**',
        'src/cli/index.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
```

### 8.3 `package.json` highlights

(Full file lives at the repo root.) Key fields:

- `"name": "@devkit/flags"`
- `"version": "0.1.0"`
- `"type": "module"`
- `"sideEffects": false`
- `"engines": { "node": ">=20" }`
- `"bin": { "flags": "./dist/cli/index.js" }`
- `"exports"` map covering all 15 entry points (root, errors, types,
  4× sources, 7× adapters, observe).
- `"peerDependencies"` + `"peerDependenciesMeta"` (all optional) for
  the 7 framework / spec peers.
- `"size-limit"` array enforcing per-entry budgets.
- `"publishConfig": { "access": "public", "provenance": true }` so
  npm provenance attestations ship.

### 8.4 `.gitignore`

Standard Node + multi-runtime layout — `node_modules/`, `dist/`,
build caches (`.turbo`, `.next`, `.svelte-kit`, `.wrangler`, `.vercel`),
test caches (`coverage/`, `.vitest-cache/`), env files (`.env`,
`.env.*.local`, `*.pem`), editor / OS files
(`.DS_Store`, `.vscode/*` with explicit allow-list for
`extensions.json`), tooling (`.eslintcache`, `.changeset/*-*.md`).

**Patterns are bare (`node_modules`, not `./node_modules`)** — `git`
treats a leading `./` differently and a misconfigured `./node_modules`
does **NOT** match the actual path during commits, leading to giant
accidentally-committed `node_modules/` trees.

### 8.5 `tsup.config.ts`

Multi-entry config — one entry per `package.json#exports` path. Shared
options:

```ts
{
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: 'terser',
  splitting: false,            // explicit subpath = no code-splitting needed
  outExtension: () => ({ js: '.js' }),
  target: 'es2022',            // narrower than tsconfig for broader runtime
                               // compat without losing readable output
  external: [
    'react', 'react-dom',
    'next', '@sveltejs/kit', 'vue', 'hono', 'express',
    '@openfeature/server-sdk',
  ],
}
```

---

## 9. Edge Cases

### 9.1 Anonymous subjects

`ctx.subject` is optional. When omitted:

- Targeting rules that only consult attributes that don't exist in the
  empty context all *fail* (matchers are non-existent-key-fails by
  default).
- Percentage rollouts hash `''` for `subjectId` — so every anonymous
  caller gets the same bucket, and they all flip together.

This is **intentional**: a logged-out user MUST receive a stable
experience across page navigations within a session. Consumers who want
per-anon stability should write a UUID into a cookie and pass it via
`ctx.subject.id`.

### 9.2 Missing attributes in matchers

`{ plan: { eq: 'pro' } }` against `{ subject: { id: 'u1' } }` (no
`plan`) returns **no match**. The only operator that *expects* missing
keys is `exists: false` — it returns true when the attribute is absent.

### 9.3 Rule order matters

Rules walk top-down; the first match wins. Authors who write
overlapping rules MUST order them most-specific-first. The codegen CLI
emits a comment block warning about this.

### 9.4 Salt rotation

Rotating the handle's `salt` invalidates **every** subject's bucket.
Every prior subject is re-bucketed under the new `(salt, flagKey, id)`
triple. Use this when you want to deliberately reshuffle an experiment;
**don't** use it when bumping a percentage (the existing salt produces
the desired "new entrants only" semantics for free).

### 9.5 Increasing rollout percentage

Going `25 → 50` adds new subjects without demoting existing ones,
because their bucket integer is unchanged and they're already
`bucket < 2500`. Going `50 → 25` *evicts* half the previously-included
subjects — the library accepts this by design (reducing exposure is
sometimes the goal). Documented in README.

### 9.6 Percentage = 0 / 100

`0` → never include (no hash computed; fast path).
`100` → always include (no hash computed; fast path).

### 9.7 Multivariate weights that don't sum to 100

`flags codegen` and `defineFlags` config validation reject this with
`INVALID_SCHEMA`. The runtime evaluator does **not** re-validate per
call (perf-critical path); the once-at-boot check is the only guard.

### 9.8 Remote source fails during boot

By default, `flags.get()` resolves with the static default and
`reason: 'STALE'`. With `{ failOpen: false }` on the remote source,
`flags.get()` **rejects** with `FlagsError('SOURCE_LOAD_FAILED')`. The
default is fail-open because the static defaults are committed in code
review and are by definition "safe enough to ship".

### 9.9 Remote source fails mid-flight

The previous snapshot is retained; `degraded: true` is set on the next
read. A back-off interval (1 s → 2 s → 4 s → … cap 30 s) controls
retry cadence. Retries reset on success.

### 9.10 SSE reconnect

`createRemoteSource(url, { transport: 'sse' })` reconnects on
disconnect with the same back-off curve. The `Last-Event-ID` header is
echoed so a server-side event log can resume from the right offset.

### 9.11 Hot-reload re-evaluates everything

When a snapshot swaps, every `subscribe` listener fires with the new
snapshot. React/Svelte components re-render; the hooks pass the new
snapshot through `useSyncExternalStore`'s `getSnapshot` so the value
flows back to consumers without manual invalidation.

### 9.12 `flags.dispose()` semantics

Tears down: file watchers, polling intervals, SSE connections,
internal observability batchers. Idempotent — calling twice is a
no-op. After dispose, subsequent `get()` / `peek()` calls **continue
to work** against the last-known frozen snapshot — this matches the
"safe to call from anywhere" invariant.

### 9.13 `process.env` mutation after handle construction

`createEnvSource()` reads env-vars at evaluation time, NOT at
construction time. So `process.env.FLAG_X = 'true'` followed by
`flags.get('x')` returns `true` even on the same tick. Tests rely on
this for harness setup.

### 9.14 Cloudflare Workers — no `process.env`

The env source's auto-detection probe (`runtime.ts`) returns
`'workers'` and the source throws `INVALID_SCHEMA` at construction
unless `opts.env` is passed. The error message points to the
`opts.env` parameter.

### 9.15 Same handle, multiple environments

A handle is **single-environment**. Building per-environment handles
in long-running processes (CMS preview switching dev/staging/prod)
is the supported pattern. Per-call `ctx.environment` overrides are
documented as a testing-only escape hatch.

### 9.16 Browser bundle leaks `process.env`

`runtime.ts` guards every `process` access behind a `typeof process`
check, but bundlers like Vite still occasionally inline a
`process.env.NODE_ENV` polyfill. We document the browser-build
pattern in README: pass `environment` explicitly and skip
`createEnvSource()` in browser bundles entirely.

### 9.17 Type narrowing in legacy TS (<5.0)

The conditional + mapped types we ship require TypeScript 5.0+. Older
TS will see `FlagValueOf` widen to `boolean | string | number | Json`
(still type-safe, just less narrow). `engines` declares `node: >=20`
but tsconfig and README mention TS 5.0+ explicitly.

### 9.18 React 18 vs 19 `use` semantics

The React adapter uses `useSyncExternalStore` (React 18+). `use()` for
Promise unwrapping in RSC is intentionally avoided — handle reads
return cached snapshots synchronously after the first await, so
RSC integration uses `await flags.get()` directly in async components
and the client adapter consumes `useSyncExternalStore`.

### 9.19 Standard Schema validators that throw

Calling `schema['~standard'].validate(value)` on a Zod / Valibot schema
returns a Result rather than throwing — but a malformed validator
might still throw. We wrap every invocation in a try/catch that emits
`JSON_SCHEMA_ERROR` and falls back to default.

### 9.20 Custom matcher fallthrough

A user's `custom: (v) => ...` callback that throws is treated as
`false` (no match), and the error is reported via the observability
hook with `code: 'RULE_EVAL_ERROR'`. We never let a user's matcher
take down a request.

---

## 10. Out of Scope (1.0)

The following are **deliberately not shipped** in 1.0. Each entry
either belongs in a separate package or is better solved by another
tool:

- **No dashboard / admin UI.** Conf lives in JSON in the repo. PR
  review is the audit log; `git blame` is the change history. A
  dashboard becomes mandatory at scale; we point users to OpenFeature
  + LaunchDarkly / GrowthBook through our OpenFeature provider.
- **No built-in stats engine.** A/B test analysis (Bayesian /
  frequentist significance) is a separate problem. We emit
  `EvaluationEvent` to PostHog / Mixpanel / your warehouse and let
  the analytics platform run the math.
- **No real-time streaming protocol of our own.** SSE is supported
  for remote sources; bidirectional WebSocket-based protocols (à la
  LaunchDarkly's streaming) are out of scope.
- **No RBAC / audit log of our own.** Git is the audit log.
- **No authentication for remote endpoints.** Pass `init: { headers }`
  to the remote source — auth is the consumer's responsibility.
- **No encrypted-at-rest flag values.** If your flag values are
  secrets, they don't belong in flags — they belong in your secret
  store.
- **No flag-deletion automation.** `flags lint` reports dead flags;
  removing them is a human PR.
- **No mobile-native (iOS / Android) SDKs.** The ESM bundle works in
  React Native; native Swift / Kotlin SDKs are a future package.
- **No experimentation feature beyond multivariate string flags.**
  Experiment-result analysis, mutual-exclusion groups,
  pre-experiment sanity-checks — explicitly deferred. We're a
  flag library, not an experimentation platform.

These boundaries are what keep the core under 3 KB and the API
learnable in 5 minutes.
