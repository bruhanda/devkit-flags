# @devkit/flags

[![npm version](https://img.shields.io/npm/v/@devkit/flags.svg?logo=npm&label=npm)](https://www.npmjs.com/package/@devkit/flags)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@devkit/flags?label=core%20gzip)](https://bundlephobia.com/package/@devkit/flags)
[![license: MIT](https://img.shields.io/npm/l/@devkit/flags.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Zero-dependency, type-safe feature flags for TypeScript — core ≤ 3 KB gzipped, isomorphic, sync evaluation with percentage rollouts and targeting.

`@devkit/flags` fills the gap between `process.env.FEATURE_X` and a $12/seat/month SaaS. Declare a typed schema once, ship it as a JSON file in your repo, and get percentage rollouts (consistent-hash bucketing), attribute-based targeting, multi-environment overrides, and first-class adapters for React, Next.js, SvelteKit, Vue, Hono, Express, and OpenFeature — without standing up a Postgres or paying per seat.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [`defineFlags`](#defineflagsconfig)
  - [`createFlags`](#createflagsconfig)
  - [`FlagsHandle`](#flagshandle)
  - [Flag specs](#flag-specs)
  - [Targeting rules](#targeting-rules)
  - [Rollouts](#rollouts)
  - [Sources](#sources)
  - [Observability](#observability)
  - [Errors](#errors)
  - [Validators](#validators)
- [Framework guides](#framework-guides)
  - [React](#react)
  - [Next.js](#nextjs)
  - [SvelteKit](#sveltekit)
  - [Vue](#vue)
  - [Hono](#hono)
  - [Express](#express)
  - [OpenFeature](#openfeature)
- [Configuration options](#configuration-options)
- [TypeScript features](#typescript-features)
- [CLI](#cli)
- [Comparison](#comparison)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Zero runtime dependencies.** Core is < 3 KB gzipped. Tree-shakeable.
- **Type-safe end to end.** `defineFlags<{...}>()` infers a literal schema; `flags.get('newCheckout')` narrows to the declared kind. Typos are compile errors.
- **Isomorphic.** One handle works on Node ≥ 20, Bun, Deno, Cloudflare Workers, Vercel Edge, browsers, and React Native.
- **Sync evaluation.** `flags.get(key)` returns synchronously from a frozen snapshot — safe to call inside React renders, hot loops, and edge handlers.
- **Percentage rollouts** with deterministic FNV-1a bucketing — `25% → 50% → 100%` ramps without re-bucketing already-included users.
- **Attribute targeting** — `eq`, `neq`, `in`, `nin`, `exists` core; `gt`, `lt`, `contains`, `startsWith`, `endsWith`, `regex`, `custom` via opt-in module.
- **Composable sources** — defaults, JSON file, env vars, remote URL (poll or SSE). Layer them; later sources override earlier per flag.
- **Hot reload** — `node:fs.watch` for JSON, `If-None-Match` polling and SSE for remote.
- **Observability hooks** — drop-in PostHog, generic batched-endpoint, or your own `onEvaluation` callback. PII-safe by default.
- **Standard Schema validation** — Zod / Valibot / Arktype validators on JSON flags.
- **OpenFeature provider adapter** — speak the CNCF standard out of the box.
- **CLI** — `flags codegen | lint | audit` for type-generation and dead-flag hygiene.

---

## Installation

```bash
npm install @devkit/flags
# or
pnpm add @devkit/flags
# or
bun add @devkit/flags
```

Requires Node ≥ 20 (for the bundled module entry); the runtime works on Bun ≥ 1, Deno ≥ 1.40, Workers, Edge, and modern browsers.

---

## Quick Start

```ts
import { defineFlags } from '@devkit/flags';

const flags = defineFlags({
  flags: {
    newCheckout: { kind: 'boolean', default: false, rollout: { percentage: 25 } },
    theme:       { kind: 'string',  default: 'light', values: ['light', 'dark'] as const },
  },
});

if (flags.get('newCheckout', { subject: { id: 'user_42' } })) {
  // 25% of users — bucket is stable across deploys
}
const theme = flags.get('theme'); // typed as 'light' | 'dark'
```

That's the whole library: declare a schema, evaluate. Add JSON / env / remote sources only when you need them.

---

## API Reference

### `defineFlags(config)`

```ts
function defineFlags<TSchema, TAttrs>(
  config: DefineFlagsConfig<TSchema, TAttrs>,
): FlagsHandle<TSchema, TAttrs>;
```

Declare a typed flag schema. Returns a frozen `FlagsHandle` safe to share across requests, edge isolates, and React renders. The schema is the single source of truth for compile-time names and value types — every subsequent `flags.get('newCheckout')` narrows to the declared kind.

The implicit `defaultsSource` runs synchronously at construction; every other source is awaited the first time `flags.getAsync()` (or `ready()`) is called, so the constructor itself never throws on async source failures (unless you opt out via `failOpen: false` on the remote source).

| Field          | Type                                                   | Description                                                            |
| -------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `flags`        | `TSchema` (required)                                   | Map of flag keys to `FlagSpec` variants — drives type inference.       |
| `attributes`   | `TAttrs`                                               | Attribute-schema descriptor; types `Subject.attributes` & rule keys.   |
| `segments`     | `Record<string, RuleGroup<TAttrs>>`                    | Named segment definitions — referenced from rules via `$segment`.      |
| `environment`  | `string`                                               | Active environment; used by the per-flag `environments` map.           |
| `sources`      | `readonly FlagSource[]`                                | Additional sources (JSON, env, remote, custom).                        |
| `subjectId`    | `(ctx) => string`                                      | Custom subject-ID extractor for bucketing. Default: `ctx.subject?.id`. |
| `salt`         | `string`                                               | Salt for the FNV-1a bucket hash. Rotate to re-bucket all users.        |
| `onEvaluation` | `(event) => void \| Promise<void>`                     | Observability hook — fires after every `get*()` call.                  |
| `redactSubject`| `(subject) => Partial<Subject>`                        | PII redactor before observability. Default: `(s) => ({ id: s.id })`.   |

**Throws** `FlagsError('INVALID_SCHEMA')` on malformed schema.

```ts
import { defineFlags } from '@devkit/flags';

const flags = defineFlags({
  flags: {
    newCheckout: {
      kind: 'boolean',
      default: false,
      rules: [{ when: { plan: { eq: 'pro' } }, value: true }],
      rollout: { percentage: 25 },
    },
    pricingTier: {
      kind: 'string',
      default: 'standard',
      values: ['standard', 'premium', 'enterprise'] as const,
    },
  },
  attributes: { plan: 'string', country: 'string' },
  environment: process.env.NODE_ENV,
  salt: 'v1',
});
```

### `createFlags(config)`

```ts
function createFlags(config: CreateFlagsConfig): FlagsHandle;
```

Lower-level factory for **dynamic** schemas — when the flag set is built at runtime (e.g. parsed from JSON received over the wire) and isn't a TypeScript literal. `flags.get()` returns `unknown`; cast at the call site.

Prefer `defineFlags` for static schemas — same runtime, full type narrowing.

### `FlagsHandle`

The handle returned by `defineFlags` / `createFlags`. Frozen; safe to share across realms.

#### Synchronous reads

```ts
flags.get(key, context?): TValue
flags.get(key, context, defaultValue): TValue
flags.getAll(context?): FlagValuesOf<TSchema>
flags.getDetail(key, context?): EvaluationResult<TValue>
```

`get` resolves the flag against the current frozen snapshot. The two-arg form returns the spec's default when no value resolved; the three-arg form lets you supply a per-call fallback (`arguments.length` is used to disambiguate from `defaultValue: undefined`).

`getAll` returns a frozen record memoised per `(context, snapshot version)` pair.

`getDetail` returns the value plus diagnostics (`reason`, `ruleId`, `bucket`, `source`, `stale`) — useful in dev tools and observability sinks.

```ts
const enabled = flags.get('newCheckout', { subject: { id: 'user_42' } });
const detail = flags.getDetail('newCheckout', { subject: { id: 'user_42' } });
//   detail.reason === 'ROLLOUT_INCLUDED'
//   detail.bucket === 1632
```

#### Asynchronous reads

```ts
flags.getAsync(key, context?): Promise<TValue>
flags.getAsync(key, context, defaultValue): Promise<TValue>
flags.getAllAsync(context?): Promise<FlagValuesOf<TSchema>>
flags.getDetailAsync(key, context?): Promise<EvaluationResult<TValue>>
```

Identical shape to the sync reads, but `await`s the initial source load on first call. After ready, subsequent calls are synchronous internally and resolve in microtask time.

#### Lifecycle

```ts
flags.ready(): Promise<void>
flags.reload(): Promise<FlagSourceSnapshot>
flags.subscribe(listener: (snapshot) => void): () => void
flags.dispose(): Promise<void>
flags.version(): number
flags.snapshot(): FlagSourceSnapshot
```

- **`ready()`** — wait for initial async sources (`createJsonSource('./flags.json')`, `createRemoteSource(...)`).
- **`reload()`** — force-refresh every source. Returns the merged snapshot. Useful from a Workers cron trigger or a manual refresh button.
- **`subscribe(listener)`** — fires on every snapshot rebuild (load, reload, file watch, SSE message). Returns an unsubscribe.
- **`dispose()`** — close all sources, clear listeners. After dispose, `reload()` throws `SOURCE_REFRESH_FAILED`.
- **`version()`** — monotonic counter that bumps on every snapshot rebuild. The React adapter uses it as the snapshot value for `useSyncExternalStore`.
- **`snapshot()`** — return the current merged `FlagSourceSnapshot` directly.

### Flag specs

A flag spec discriminates on `kind`. Every variant supports `description`, `tags`, `deprecated`, `environments`, `rules`, and `rollout`.

#### `BooleanFlagSpec`

```ts
{
  kind: 'boolean',
  default: boolean,
  rules?: Rule<boolean>[],
  rollout?: Rollout<boolean>,
  environments?: Record<string, boolean>,
}
```

#### `StringFlagSpec`

```ts
{
  kind: 'string',
  default: string,
  values?: readonly string[],     // narrows the type to a literal union
  rules?: Rule<string>[],
  rollout?: Rollout<string>,
  environments?: Record<string, string>,
}
```

Pass `values: [...] as const` to narrow `flags.get('theme')` to the literal union. Out-of-allowlist coercions fall back to `default`.

#### `NumberFlagSpec`

```ts
{
  kind: 'number',
  default: number,
  range?: [number, number],       // [min, max] clamp at coercion time
  rules?: Rule<number>[],
  rollout?: Rollout<number>,
  environments?: Record<string, number>,
}
```

#### `JsonFlagSpec`

```ts
{
  kind: 'json',
  default: TShape,
  schema?: StandardSchemaV1<TShape>,   // Zod / Valibot / Arktype
  rules?: Rule<TShape>[],
  rollout?: Rollout<TShape>,
  environments?: Record<string, TShape>,
}
```

When `schema` is supplied, every value flowing in from a non-defaults source is validated; failures throw `JSON_SCHEMA_ERROR` and the resolution falls back to `default`.

### Targeting rules

A `Rule` is a guard plus an outcome. The outcome may be a fixed `value`, a `rollout`, or both — when neither is set, the rule is analytics-only (fires the observability hook and falls through).

```ts
rules: [
  {
    id: 'pro-tier',                          // optional, flows to observability
    when: {
      plan: { eq: 'pro' },                   // implicit AND on attribute keys
      $or: [
        { country: { in: ['US', 'CA'] } },
        { $segment: 'beta_testers' },        // reference a named segment
      ],
    },
    value: true,
  },
];
```

The `when` clause is a `RuleGroup`:

| Form              | Meaning                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `{ key: matcher }`| Implicit AND of matchers on attribute keys                                                             |
| `{ $and: [...] }` | Explicit AND                                                                                           |
| `{ $or: [...] }`  | OR                                                                                                     |
| `{ $not: ... }`   | Negation                                                                                               |
| `{ $segment: x }` | Reference a `RuleGroup` declared in `defineFlags({ segments: { x: ... } })`                            |

#### Matchers

Core (always available):

| Operator     | Type                       | Behavior                                       |
| ------------ | -------------------------- | ---------------------------------------------- |
| `eq`         | `Json`                     | Equality                                       |
| `neq`        | `Json`                     | Inequality                                     |
| `in`         | `readonly Json[]`          | Membership                                     |
| `nin`        | `readonly Json[]`          | Non-membership                                 |
| `exists`     | `boolean`                  | Attribute presence                             |

Extended (opt-in — `import '@devkit/flags/matchers/extended'` once):

| Operator     | Type                          | Behavior                                                                          |
| ------------ | ----------------------------- | --------------------------------------------------------------------------------- |
| `gt`         | `number \| string`            | Greater than                                                                      |
| `gte`        | `number \| string`            | Greater than or equal                                                             |
| `lt`         | `number \| string`            | Less than                                                                         |
| `lte`        | `number \| string`            | Less than or equal                                                                |
| `contains`   | `string`                      | Substring match                                                                   |
| `startsWith` | `string`                      | Prefix match                                                                      |
| `endsWith`   | `string`                      | Suffix match                                                                      |
| `regex`      | `{ regex: string, flags? }`   | Regex match — 50 ms cooperative timeout, auto-disables after 5 consecutive timeouts |
| `custom`     | `(value) => boolean`          | In-code callback (rejected from JSON / remote sources for safety)                 |

```ts
import { defineFlags } from '@devkit/flags';
import '@devkit/flags/matchers/extended';   // side-effect import: register `gt`/`regex`/etc.

const flags = defineFlags({
  flags: {
    enterpriseDashboard: {
      kind: 'boolean',
      default: false,
      rules: [{ when: { annualRevenue: { gt: 1_000_000 } }, value: true }],
    },
  },
  attributes: { annualRevenue: 'number' },
});
```

### Rollouts

A `Rollout` bucketizes the subject deterministically via FNV-1a 32-bit hashing:

```
bucket = FNV-1a(salt + ':' + flagKey + ':' + subjectId) % 10_000
```

Two shapes:

```ts
// Percentage — 0..N enables, the rest returns the spec default.
{ percentage: 25 }

// Multivariate — keys must match the flag's value set when typed.
{ variants: { 'A': 50, 'B': 30, 'C': 20 } }
```

Bumping `percentage` from 25 → 50 includes a strict superset of users — already-enabled subjects stay enabled. Rotate `salt` (or override `subjectId`) to re-roll the dice.

### Sources

A `FlagSource` produces a `FlagSourceSnapshot` of `flags + segments`. The handle composes them in priority order — later sources override earlier per flag key.

#### `defaultsSource(flags)`

Implicit. Synchronous. Built from the schema's `default` fields. You never have to call this manually.

#### `createJsonSource(input, opts?)` — `@devkit/flags/sources/json`

```ts
createJsonSource(
  input: string | URL | FlagsJsonInput | (() => Promise<...>),
  opts?: { watch?: boolean; encoding?: BufferEncoding }
): FlagSource
```

Four input forms:

```ts
createJsonSource('./flags.json');                     // path (Node / Bun)
createJsonSource(new URL('https://cdn/flags.json'));  // HTTP(S)
createJsonSource({ flags: { ... } });                 // inline object
createJsonSource(() => readFromCms());                // async producer
```

`opts.watch: true` enables `node:fs.watch` (Node / Bun only — no-op elsewhere). The source rejects the JSON-unsafe `custom` matcher with `UNSAFE_MATCHER_FROM_JSON`.

#### `createEnvSource(opts?)` — `@devkit/flags/sources/env`

```ts
createEnvSource({
  prefix?: string,                          // default 'FLAG_'
  env?: Record<string, string | undefined>, // required on Workers
  toEnvVarName?: (flagKey) => string,       // override the camelCase → SCREAMING_SNAKE
  allow?: readonly string[] | '*',          // 'schema' (default), explicit list, or '*'
}): FlagSource
```

Reads overrides from environment variables. Key transform: `newCheckout` → `FLAG_NEW_CHECKOUT`. Values are coerced based on the flag's declared `kind` **at evaluation time** — useful in tests where you mutate `process.env` mid-process.

```bash
FLAG_NEW_CHECKOUT=true FLAG_THEME=dark node ./server.js
```

Accidental collisions (`FLAG_INTERNAL_DEBUG_TOKEN`) emit a one-time `console.warn`. Cloudflare Workers must pass `env` explicitly — auto-detection isn't possible.

#### `createRemoteSource(url, opts?)` — `@devkit/flags/sources/remote`

```ts
createRemoteSource(url: string | URL, opts?: {
  pollInterval?: number,         // ms, default 60_000; rejected on Workers
  transport?: 'poll' | 'sse',    // default 'poll'; SSE rejected on RN
  fetch?: typeof fetch,
  init?: RequestInit,
  maxBytes?: number,             // default 64 KiB
  requestTimeoutMs?: number,     // default 5_000
  backoff?: { base: number, cap: number },  // default { base: 1_000, cap: 30_000 }
  failOpen?: boolean,            // default true
}): FlagSource
```

Polls a JSON snapshot from a URL with `If-None-Match` / 304 handling — polling against a CDN is essentially free. With `transport: 'sse'`, subscribes to an EventSource stream and parses every message as a snapshot.

`failOpen: true` (default) resolves `flags.ready()` against static defaults if the initial fetch fails. Pass `false` to reject hard.

On Cloudflare Workers, set up a Cron Trigger or Durable Object alarm that calls `flags.reload()` instead of polling — `pollInterval` is rejected with `INVALID_RUNTIME_OPTION`.

#### `composeSources(sources, opts?)` — `@devkit/flags/sources/compose`

```ts
composeSources(sources: readonly FlagSource[], opts?: {
  merge?: (key: string, layers: readonly FlagSpec[]) => FlagSpec,
}): FlagSource
```

Combines multiple sources. Index 0 is lowest priority; later sources override earlier per flag. The optional `merge` callback runs per flag key when more than one source defines it (default: last-wins object replacement).

`defineFlags` calls this automatically when you pass `sources: [...]` — use `composeSources` directly only when you want a custom merger.

### Observability

```ts
import { toConsole, toPostHog, toEndpoint } from '@devkit/flags/observe';

defineFlags({
  flags: { ... },
  onEvaluation: toPostHog(posthogClient),
  // or: toConsole('debug')
  // or: toEndpoint('https://example.com/flag-events', { batchSize: 50 })
});
```

| Hook                                | What it does                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `toConsole(level?)`                 | `console[level]` each evaluation. Dev only.                                                     |
| `toPostHog(client)`                 | Captures a `feature_flag_evaluated` event with `flag_key`, `flag_value`, `reason`, etc.         |
| `toEndpoint(url, opts?)`            | Buffer + POST batched JSON to your endpoint. `batchSize`, `flushIntervalMs`, `forwardAttributes`. |

`EvaluationEvent` payload:

| Field         | Type                                | Meaning                                              |
| ------------- | ----------------------------------- | ---------------------------------------------------- |
| `flagKey`     | `string`                            | Flag key                                             |
| `value`       | `unknown`                           | Resolved value                                       |
| `reason`      | `EvaluationReason`                  | `STATIC` \| `TARGETING_MATCH` \| `ROLLOUT_INCLUDED` \| ... |
| `ruleId`      | `string?`                           | Matched rule's `id`                                  |
| `bucket`      | `number?`                           | `0..9999` for rollout debugging                      |
| `subject`     | `{ id: string } \| Subject`         | Redacted subject (PII-safe)                          |
| `environment` | `string`                            | Active environment                                   |
| `timestamp`   | `number`                            | Unix epoch ms                                        |
| `error`       | `{ code, message }?`                | Set when `reason === 'ERROR'`                        |

By default, only `subject.id` is forwarded — attributes are stripped to keep PII out of analytics. Opt back in with `redactSubject: (s) => s` in `defineFlags`. Hook errors are caught and logged; they never propagate into `flags.get()`.

### Errors

```ts
import { FlagsError } from '@devkit/flags';

try {
  flags.get('newCheckout');
} catch (err) {
  if (FlagsError.is(err)) {
    console.error(err.code, err.message, err.context);
  }
}
```

`FlagsError` is the only error type the library throws. `FlagsError.is(err)` is realm-safe — it works across worker / iframe / Node-VM boundaries.

| Code                       | When it fires                                                                  |
| -------------------------- | ------------------------------------------------------------------------------ |
| `INVALID_SCHEMA`           | `defineFlags` received a malformed schema                                      |
| `INVALID_RUNTIME_OPTION`   | Source option illegal in the current runtime (e.g. `pollInterval` on Workers) |
| `UNKNOWN_FLAG`             | `flags.get('typo')` and no schema entry exists                                 |
| `JSON_PARSE_ERROR`         | `createJsonSource` received unparseable input                                  |
| `UNSAFE_MATCHER_FROM_JSON` | A `custom` matcher appeared in JSON / remote source                            |
| `JSON_SCHEMA_ERROR`        | A Standard-Schema validator rejected a JSON flag's value                       |
| `TYPE_MISMATCH`            | A source produced a value the wrong shape for the schema                       |
| `SOURCE_LOAD_FAILED`       | Initial `source.load()` rejected and `failOpen: false`                         |
| `SOURCE_REFRESH_FAILED`    | `flags.reload()` failed                                                        |
| `PAYLOAD_TOO_LARGE`        | Remote response exceeded `maxBytes`                                            |
| `OBSERVABILITY_HOOK_ERROR` | `onEvaluation` threw — caught and logged                                       |
| `RULE_EVAL_ERROR`          | A matcher threw during rule evaluation                                         |
| `REGEX_TIMEOUT`            | Regex matcher exceeded the 50 ms cooperative budget                            |
| `REGEX_DISABLED`           | Auto-disabled after 5 consecutive regex timeouts                               |
| `STALE_READ`               | Sync read against a snapshot that's still loading                              |

### Validators

```ts
import { z } from 'zod';
import { defineFlags } from '@devkit/flags';

const flags = defineFlags({
  flags: {
    pricing: {
      kind: 'json',
      default: { tier: 'free', price: 0 },
      schema: z.object({ tier: z.enum(['free', 'pro']), price: z.number() }),
    },
  },
});
```

The `schema` field accepts any [Standard Schema](https://standardschema.dev) compatible validator (Zod, Valibot, Arktype, …). The library doesn't peer-depend on any of them — it uses the `~standard` duck type.

Direct API at `@devkit/flags/validators/standard-schema`:

```ts
validate<T>(schema, value): Promise<{ ok: true; value: T } | { ok: false; error: FlagsError }>
validateSync<T>(schema, value): { ok: true; value: T } | { ok: false; error: FlagsError }
```

---

## Framework guides

### React

```tsx
// flags.ts
import { defineFlags } from '@devkit/flags';
export const flags = defineFlags({
  flags: { newCheckout: { kind: 'boolean', default: false } },
});
```

```tsx
// app.tsx
import { createReactBindings } from '@devkit/flags/adapters/react';
import { flags } from './flags';

const { FlagsProvider, useFlag, useFlagResult, useFlags, Flag } =
  createReactBindings(flags);

export default function App({ user }) {
  return (
    <FlagsProvider flags={flags} context={{ subject: { id: user.id } }}>
      <Checkout />
    </FlagsProvider>
  );
}

function Checkout() {
  const enabled = useFlag('newCheckout', /* fallback */ false);
  return enabled ? <NewCheckout /> : <OldCheckout />;
}

// Or declarative:
<Flag name="newCheckout" fallback={<OldCheckout />}>
  <NewCheckout />
</Flag>
```

`useFlag` and friends use `useSyncExternalStore` against `flags.version()`, so concurrent rendering and SSR streaming work without tearing. Pass `initialSnapshot` to `<FlagsProvider>` for SSR hydration.

### Next.js

**Server (RSC, route handler, server action):**

```ts
import { getFlag } from '@devkit/flags/adapters/next';
import { flags } from '@/lib/flags';

export default async function Page() {
  const enabled = await getFlag(flags, 'newCheckout', {
    subject: { id: 'user_42' },
  });
  return enabled ? <NewCheckout /> : <OldCheckout />;
}
```

**Edge middleware:**

```ts
// middleware.ts
import { flagsMiddleware } from '@devkit/flags/adapters/next';
import { flags } from '@/lib/flags';

export default flagsMiddleware(flags, {
  cookieName: 'devkit-flags-subject',
  extractSubject: (req) => {
    const id = req.cookies.get('uid')?.value;
    return id ? { id } : undefined;
  },
});
```

**Snapshot route handler** — useful for the React client to bootstrap from the same merged source set as the server:

```ts
// app/api/flags/route.ts
import { createFlagsRoute } from '@devkit/flags/adapters/next';
import { flags } from '@/lib/flags';
export const GET = createFlagsRoute(flags);
```

### SvelteKit

```ts
// hooks.server.ts
import { flagsHandle } from '@devkit/flags/adapters/sveltekit';
import { flags } from '$lib/flags';

export const handle = flagsHandle(flags, {
  cookieName: 'devkit-flags-subject',
  extractSubject: (event) => {
    const id = event.cookies.get('uid');
    return id ? { id } : undefined;
  },
});
```

Inside a load function:

```ts
export const load = ({ locals }) => ({
  newCheckout: locals.flags.get('newCheckout'),
});
```

### Vue

```ts
// main.ts
import { createApp } from 'vue';
import { createFlagsPlugin } from '@devkit/flags/adapters/vue';
import { flags } from './flags';

const app = createApp(App);
app.use(createFlagsPlugin(flags, { context: { subject: { id: 'user_42' } } }));
```

```vue
<script setup lang="ts">
import { useFlag } from '@devkit/flags/adapters/vue';
const enabled = useFlag('newCheckout');
</script>

<template>
  <NewCheckout v-if="enabled" />
  <OldCheckout v-else />
</template>
```

### Hono

```ts
import { Hono } from 'hono';
import { honoFlags } from '@devkit/flags/adapters/hono';
import { flags } from './flags';

const app = new Hono();
app.use('*', honoFlags(flags));

app.get('/', (c) =>
  c.json({ enabled: c.var.flag('newCheckout') }),
);
```

`c.var.flag(key)` is the typed accessor; `c.var.flags` exposes the full handle when you need `getDetail` / `getAll`.

### Express

```ts
import express from 'express';
import { expressFlags } from '@devkit/flags/adapters/express';
import { flags } from './flags';

const app = express();
app.use(expressFlags(flags));

app.get('/', (req, res) =>
  res.json({ enabled: req.flag('newCheckout') }),
);
```

### OpenFeature

`@devkit/flags` doubles as an OpenFeature provider, so you can adopt the CNCF API today and swap the provider later without touching call sites.

```ts
import { OpenFeature } from '@openfeature/server-sdk';
import { createOpenFeatureProvider } from '@devkit/flags/adapters/openfeature';
import { flags } from './flags';

OpenFeature.setProvider(createOpenFeatureProvider(flags));

const client = OpenFeature.getClient();
const enabled = await client.getBooleanValue('newCheckout', false);
```

`EvaluationReason` values are translated to OpenFeature's standard `ResolutionReason` strings (`STATIC`, `TARGETING_MATCH`, `SPLIT`, `ERROR`, …).

---

## Configuration options

| Option            | Type                                | Default                       | Notes                                                                |
| ----------------- | ----------------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `flags`           | `FlagSchema`                        | —                             | **Required.** Map of keys to `FlagSpec`.                             |
| `attributes`      | `AttributeSchema`                   | —                             | Type narrowing for `Subject.attributes` and rule keys.               |
| `segments`        | `Record<string, RuleGroup>`         | —                             | Reusable rule groups, referenced by `$segment`.                      |
| `environment`     | `string`                            | —                             | Active environment; consults each flag's `environments` map.         |
| `sources`         | `FlagSource[]`                      | `[]`                          | Layered with implicit `defaultsSource`.                              |
| `subjectId`       | `(ctx) => string`                   | `(ctx) => ctx.subject?.id ?? ''` | Custom bucketing key.                                                |
| `salt`            | `string`                            | `''`                          | Rotates the entire bucket map.                                       |
| `onEvaluation`    | `(event) => void \| Promise<void>`  | —                             | Observability hook. Errors caught.                                   |
| `redactSubject`   | `(subject) => Partial<Subject>`     | `(s) => ({ id: s.id })`       | PII redactor before observability.                                   |

### Source-specific

| Source                | Key options                                                                          |
| --------------------- | ------------------------------------------------------------------------------------ |
| `createJsonSource`    | `watch`, `encoding`                                                                  |
| `createEnvSource`     | `prefix` (`'FLAG_'`), `env`, `toEnvVarName`, `allow` (`'schema'` \| `string[]` \| `'*'`) |
| `createRemoteSource`  | `pollInterval` (60 s), `transport`, `fetch`, `init`, `maxBytes` (64 KiB), `requestTimeoutMs` (5 s), `backoff`, `failOpen` |

---

## TypeScript features

`@devkit/flags` is built around TypeScript's literal-type machinery — every guarantee falls out of `defineFlags<TSchema>`'s inference.

**1. Compile-time flag-name validation.** Typos are errors:

```ts
flags.get('newCheckOut'); // ❌ Argument of type '"newCheckOut"' is not assignable to '"newCheckout" | "theme"'.
```

**2. Return type narrows to the declared kind.**

```ts
const a = flags.get('newCheckout'); // boolean
const b = flags.get('theme');       // 'light' | 'dark'   (with `values: [...] as const`)
const c = flags.get('limits');      // the shape inferred from `default` / `schema`
```

**3. Attribute schema flows into rules and contexts.**

```ts
const flags = defineFlags({
  flags: { /* … */ },
  attributes: { plan: 'string', annualRevenue: 'number' } as const,
});

flags.get('x', {
  subject: { id: 'u', attributes: { plan: 'free', annualRevenue: '$1m' } },
  //                                                ^^^^^^^^ ❌ Type 'string' is not assignable to 'number'
});
```

**4. Segment names are typed.** A `$segment` reference that doesn't appear in `config.segments` is a compile error.

**5. Standard Schema integration.** Pass any Zod / Valibot / Arktype validator via `schema` on a JSON flag — the resolved value is typed to the validator's output, not the loose `Json` type.

**6. Bindings factory.** `createReactBindings(flags)` returns hooks pre-narrowed to the handle's generics — no need to thread `<TSchema>` through every component.

---

## CLI

The package ships a `flags` bin with three subcommands.

```bash
# Generate a typed defineFlags<{...}>() module from flags.json
npx flags codegen --in flags.json --out src/flags.generated.ts

# Report dead flags (declared but never read) and unknown keys (read but not declared)
npx flags lint --in flags.json --src src
npx flags lint --in flags.json --src src --json   # machine-readable

# Audit — structured snapshot of every declared flag
npx flags audit --in flags.json
npx flags audit --in flags.json --json
```

`lint` exits non-zero when issues are found — wire it into CI alongside your linter.

The runtime API is exposed via `@devkit/flags/cli`:

```ts
import { runCodegen, runLint, runAudit } from '@devkit/flags/cli';

await runCodegen({ inPath: 'flags.json', outPath: 'src/flags.generated.ts' });
const lintReport = await runLint({ flagsJsonPath: 'flags.json', srcRoot: 'src' });
const auditReport = await runAudit({ flagsJsonPath: 'flags.json' });
```

---

## Comparison

| Library                          | Bundle (gzip) | Infra required | Type-safe API   | Percentage rollout | Targeting | Edge / Workers | License        |
| -------------------------------- | ------------- | -------------- | --------------- | ------------------ | --------- | -------------- | -------------- |
| **`@devkit/flags`**              | **< 3 KB**    | **none**       | **✅ literal types** | **✅ FNV-1a**     | **✅**    | **✅**         | **MIT**        |
| `unleash-client`                 | ~30 KB        | Unleash + Postgres | partial      | ✅                 | ✅        | partial        | Apache-2.0     |
| `@growthbook/growthbook`         | ~16 KB        | self-host or SaaS | ✅           | ✅                 | ✅        | ✅             | MIT            |
| `flagsmith-nodejs`               | ~25 KB        | Flagsmith + Postgres | partial    | ✅                 | ✅        | ❌             | BSD-3          |
| `launchdarkly-node-server-sdk`   | 50 KB+        | LaunchDarkly SaaS | partial      | ✅                 | ✅        | ❌             | Apache-2.0     |
| `flagged` (React)                | ~1 KB         | none            | partial         | ❌                 | ❌        | n/a            | MIT            |
| `@openfeature/server-sdk`        | ~5 KB         | provider needed | partial         | provider-specific  | provider  | partial        | Apache-2.0     |
| `flags` (ex-`@vercel/flags`)     | ~4 KB         | Vercel / Edge Config | ✅          | ✅                 | partial   | ✅             | MIT            |

**Where `@devkit/flags` wins**

- **Zero infrastructure.** Drop a JSON file in your repo. No Postgres, no dashboard, no SaaS.
- **Smallest non-React bundle on the list.** 3 KB core; adapters are individually < 1 KB.
- **Best-in-class TypeScript inference.** Most competitors use `string` keys; we narrow to literals.
- **One library, every runtime.** Node, Bun, Deno, Workers, Edge, browsers, React Native — same handle, no conditional bundles.
- **GitOps native.** Flags are a JSON file under code review with `git blame` audit trail.

**Where `@devkit/flags` loses**

- **No dashboard.** By design — but if your PMs want a UI, point them at LaunchDarkly / Flagsmith.
- **No built-in stats engine.** Export evaluations via `onEvaluation` to PostHog / Statsig / your warehouse instead.
- **No real-time streaming protocol.** SSE works against any compliant server, but there's no purpose-built protocol like LaunchDarkly's.

If you outgrow this library, `createOpenFeatureProvider` lets you migrate to LaunchDarkly / ConfigCat / GO Feature Flag without touching call sites.

---

## Contributing

Contributions, issues, and feature requests are welcome.

```bash
git clone https://github.com/j09822475-dev/devkit-flags.git
cd devkit-flags
npm install
npm test
npm run build
```

The repo uses [Biome](https://biomejs.dev) for lint/format, [Vitest](https://vitest.dev) for tests, [tsup](https://tsup.egoist.dev) for the build, and [size-limit](https://github.com/ai/size-limit) to keep the core under 3 KB. Open a PR against `main` — every entry point ships with its own size budget enforced in CI.

---

## License

MIT © 2026 [Vasyl Bruhanda](https://github.com/j09822475-dev). See [LICENSE](./LICENSE).
