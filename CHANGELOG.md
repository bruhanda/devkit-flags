# Changelog

All notable changes to `@devkit/flags` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-04

Initial public release.

### Added

- **Core API.** `defineFlags<TSchema, TAttrs>()` and `createFlags()` factories returning a frozen, isomorphic `FlagsHandle`. Synchronous `get` / `getAll` / `getDetail` and async counterparts; `ready`, `reload`, `subscribe`, `dispose`, `version`, and `snapshot` lifecycle methods.
- **Type-safe schema.** Literal-type inference from the `flags` map narrows `flags.get(key)` to the declared kind (`boolean`, `string`, `number`, `json`); `as const` value tuples on string flags narrow to the literal union; `attributes` schema flows into `Subject.attributes` and rule keys; segment names are typed.
- **Percentage rollouts** with deterministic FNV-1a 32-bit bucketing — bumping `percentage` includes a strict superset of subjects.
- **Multivariate rollouts** with weighted variants.
- **Targeting rules** — guard + outcome pairs with implicit-AND, `$and`, `$or`, `$not`, and `$segment` composition.
- **Core matchers** — `eq`, `neq`, `in`, `nin`, `exists`.
- **Extended matchers** (opt-in via `@devkit/flags/matchers/extended`) — `gt`, `gte`, `lt`, `lte`, `contains`, `startsWith`, `endsWith`, `regex` (50 ms cooperative timeout, auto-disable after 5 consecutive timeouts), `custom`.
- **Sources.** Implicit `defaultsSource`; `createJsonSource` (path / URL / inline / async producer; optional `node:fs.watch`); `createEnvSource` (`FLAG_*` prefix, allowlist modes, runtime-aware); `createRemoteSource` (poll with `If-None-Match` + 304, or SSE; `failOpen` defaults to safe). `composeSources` for layered overrides.
- **Standard Schema validators.** Zod / Valibot / Arktype on JSON flags via the duck-typed `~standard` interface — no peer dependency required.
- **Observability.** `onEvaluation` hook with PII-safe default redaction; built-in `toConsole`, `toPostHog`, and `toEndpoint` (batched POST) sinks. Hook errors are caught and logged.
- **Errors.** Single `FlagsError` class with stable `code` enum (`INVALID_SCHEMA`, `INVALID_RUNTIME_OPTION`, `UNKNOWN_FLAG`, `JSON_PARSE_ERROR`, `UNSAFE_MATCHER_FROM_JSON`, `JSON_SCHEMA_ERROR`, `TYPE_MISMATCH`, `SOURCE_LOAD_FAILED`, `SOURCE_REFRESH_FAILED`, `PAYLOAD_TOO_LARGE`, `OBSERVABILITY_HOOK_ERROR`, `RULE_EVAL_ERROR`, `REGEX_TIMEOUT`, `REGEX_DISABLED`, `STALE_READ`) and realm-safe `FlagsError.is()` guard.
- **Framework adapters.**
  - React (`@devkit/flags/adapters/react`) — `FlagsProvider`, `useFlag`, `useFlagResult`, `useFlags`, `<Flag>`, plus `createReactBindings(flags)` for pre-narrowed hooks. Backed by `useSyncExternalStore` for concurrent-mode safety.
  - Next.js (`@devkit/flags/adapters/next`) — `getFlag`, `flagsMiddleware`, `createFlagsRoute` for RSC, edge middleware, and snapshot handlers.
  - SvelteKit (`@devkit/flags/adapters/sveltekit`) — `flagsHandle` populating `event.locals.flags`.
  - Vue (`@devkit/flags/adapters/vue`) — `createFlagsPlugin` and reactive `useFlag` composable.
  - Hono (`@devkit/flags/adapters/hono`) — `honoFlags` middleware exposing `c.var.flag` and `c.var.flags`.
  - Express (`@devkit/flags/adapters/express`) — `expressFlags` middleware adding `req.flag` and `req.flags`.
  - OpenFeature (`@devkit/flags/adapters/openfeature`) — `createOpenFeatureProvider` returning a v1.x `ServerProvider`. `EvaluationReason` translation.
- **CLI.** `flags codegen`, `flags lint`, `flags audit` subcommands with text and `--json` outputs. Programmatic API at `@devkit/flags/cli` (`runCodegen`, `runLint`, `runAudit`).
- **Subpath exports.** Every adapter, source, validator, and the CLI are isolated subpaths with individual size budgets — the root entry (`@devkit/flags`) is a tree-shakeable ≤ 3 KB gzipped.
- **Runtime support.** Node ≥ 20, Bun ≥ 1, Deno ≥ 1.40, Cloudflare Workers, Vercel Edge, Netlify Edge, modern browsers, React Native.
- **Zero runtime dependencies.** Adapter peer dependencies (React, Vue, SvelteKit, Hono, Express, Next, OpenFeature SDK) are all optional.

[0.1.0]: https://github.com/j09822475-dev/devkit-flags/releases/tag/v0.1.0
