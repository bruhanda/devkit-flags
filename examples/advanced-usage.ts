/**
 * advanced-usage.ts — a realistic, multi-feature scenario.
 *
 * Run:  npx tsx examples/advanced-usage.ts
 *
 * Demonstrates:
 *  - typed `attributes` flowing into rules and contexts
 *  - reusable `segments` referenced via `$segment`
 *  - core matchers (`eq`, `in`) composing rule guards
 *  - multivariate rollouts (A/B/C with weights)
 *  - per-environment overrides
 *  - JSON file source layered over the schema defaults
 *  - observability hook (`onEvaluation`) recording each evaluation
 *  - `getDetail` for full diagnostics including bucket and rule id
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineFlags } from '@devkit/flags';
import { createJsonSource } from '@devkit/flags/sources/json';
import { toConsole } from '@devkit/flags/observe';
import type { EvaluationEvent } from '@devkit/flags';

// 1. Stage a small flags.json overlay on disk so the JSON source has
//    something to load. In a real app this file lives under version control;
//    the same merged-source story works with `createRemoteSource` against a
//    CDN URL or `createEnvSource` for env-var overrides.
const tempDir = join(tmpdir(), `devkit-flags-example-${process.pid}`);
await mkdir(tempDir, { recursive: true });
const flagsJsonPath = join(tempDir, 'flags.json');
await writeFile(
  flagsJsonPath,
  JSON.stringify(
    {
      flags: {
        // Operations bump the cap without redeploying the app.
        apiTimeoutMs: { kind: 'number', default: 8000, range: [100, 30000] },
      },
    },
    null,
    2,
  ),
);

// 2. Collect events through an observability hook. Real apps would forward
//    these to PostHog / a batched HTTP endpoint / their warehouse.
const events: EvaluationEvent[] = [];

const flags = defineFlags({
  attributes: {
    plan: 'string',
    country: 'string',
    accountType: 'string',
  },
  segments: {
    enterprise: { accountType: { eq: 'enterprise' } },
    apac: { country: { in: ['JP', 'KR', 'AU', 'NZ', 'SG'] } },
  },
  environment: process.env.NODE_ENV ?? 'development',
  flags: {
    newCheckout: {
      kind: 'boolean',
      default: false,
      rollout: { percentage: 5 }, // overridden by flags.json (50%)
      // Pro-tier users always see it, regardless of bucket.
      rules: [{ id: 'pro-tier', when: { plan: { eq: 'pro' } }, value: true }],
    },
    pricingTier: {
      kind: 'string',
      default: 'standard',
      values: ['standard', 'premium', 'enterprise'] as const,
      rules: [
        { id: 'enterprise-segment', when: { $segment: 'enterprise' }, value: 'enterprise' },
        { id: 'apac-bump', when: { $segment: 'apac' }, value: 'premium' },
      ],
    },
    homepageVariant: {
      kind: 'string',
      default: 'A',
      values: ['A', 'B', 'C'] as const,
      // Multivariate rollout — weights must match `values`.
      rollout: { variants: { A: 50, B: 30, C: 20 } },
    },
    maintenanceBanner: {
      kind: 'boolean',
      default: false,
      // Different default per environment.
      environments: { development: true, staging: true, production: false },
    },
    apiTimeoutMs: {
      kind: 'number',
      default: 3000,
      range: [100, 30000],
    },
  },
  sources: [createJsonSource(flagsJsonPath)],
  onEvaluation: (event) => {
    events.push(event);
    // Mirror to console too — comment out for production.
    toConsole('debug')(event);
  },
});

await flags.ready();

// 3. Different subjects, different outcomes.
const subjects = [
  { id: 'alice', plan: 'free', country: 'US', accountType: 'self-serve' },
  { id: 'bob', plan: 'pro', country: 'DE', accountType: 'self-serve' },
  { id: 'carol', plan: 'free', country: 'JP', accountType: 'enterprise' },
  { id: 'dave', plan: 'free', country: 'AU', accountType: 'self-serve' },
];

console.log('\n--- per-subject evaluations ---');
for (const s of subjects) {
  const ctx = {
    subject: { id: s.id, attributes: { plan: s.plan, country: s.country, accountType: s.accountType } },
  };
  const checkout = flags.getDetail('newCheckout', ctx);
  const tier = flags.getDetail('pricingTier', ctx);
  const variant = flags.getDetail('homepageVariant', ctx);
  console.log(
    `${s.id.padEnd(6)} plan=${s.plan.padEnd(4)} country=${s.country} type=${s.accountType.padEnd(11)} ` +
      `→ checkout=${String(checkout.value).padEnd(5)} (${checkout.reason}) ` +
      `tier=${String(tier.value).padEnd(11)} (${tier.reason}) ` +
      `variant=${String(variant.value)} (${variant.reason})`,
  );
}

console.log('\n--- environment-aware default ---');
console.log(
  `maintenanceBanner in ${process.env.NODE_ENV ?? 'development'}: ${flags.get('maintenanceBanner')}`,
);

console.log('\n--- JSON source overlays the schema default at load time ---');
console.log(`apiTimeoutMs schema default: 3000`);
console.log(`apiTimeoutMs after JSON overlay: ${flags.get('apiTimeoutMs')}`);

console.log('\n--- snapshot diagnostics ---');
console.log(`snapshot version: ${flags.version()}`);
console.log(`evaluations recorded: ${events.length}`);
const reasonCounts = events.reduce<Record<string, number>>((acc, e) => {
  acc[e.reason] = (acc[e.reason] ?? 0) + 1;
  return acc;
}, {});
console.log(`reasons: ${JSON.stringify(reasonCounts)}`);

await flags.dispose();
await rm(tempDir, { recursive: true, force: true });
