# `@devkit/flags` — examples

Runnable local examples. Every file is a standalone `tsx` script — clone the repo, install dependencies, and run any of them directly.

```bash
git clone https://github.com/bruhanda/devkit-flags.git
cd devkit-flags
npm install
npm run build       # builds dist/ — examples import @devkit/flags by name

npx tsx examples/basic-usage.ts
npx tsx examples/advanced-usage.ts
npx tsx examples/with-hono.ts
npx tsx examples/with-express.ts
```

| Example                                           | What it shows                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`basic-usage.ts`](./basic-usage.ts)              | Schema declaration, type-narrowed reads, percentage rollout with deterministic bucketing.       |
| [`advanced-usage.ts`](./advanced-usage.ts)        | Attributes, segments, multivariate rollouts, environments, JSON file source, observability.    |
| [`with-hono.ts`](./with-hono.ts)                  | `honoFlags` middleware exercised through `app.fetch()` — same code runs on Workers / Bun / Deno.|
| [`with-express.ts`](./with-express.ts)            | `expressFlags` middleware on a short-lived `node:http` server with env-var overrides.           |

Each example also has a StackBlitz-ready sandbox under [`./sandbox/`](./sandbox).
