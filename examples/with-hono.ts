/**
 * with-hono.ts — feature flags inside a Hono application.
 *
 * Run:  npx tsx examples/with-hono.ts
 *
 * Demonstrates:
 *  - mounting `honoFlags(flags)` middleware on every route
 *  - subject extraction from a cookie (default behaviour)
 *  - the typed `c.var.flag(key)` accessor inside route handlers
 *  - exercising the app via `app.fetch()` — no node:http server needed,
 *    so the same code drops straight into Cloudflare Workers / Bun /
 *    Deno without modification
 */

import { Hono } from 'hono';

import { defineFlags } from '@devkit/flags';
import { honoFlags } from '@devkit/flags/adapters/hono';
import type { FlagsHandle, FlagSchema } from '@devkit/flags';

const flags = defineFlags({
  flags: {
    newCheckout: {
      kind: 'boolean',
      default: false,
      rollout: { percentage: 25 },
    },
    pricingTier: {
      kind: 'string',
      default: 'standard',
      values: ['standard', 'premium'] as const,
      rules: [{ when: { plan: { eq: 'pro' } }, value: 'premium' }],
    },
  },
  attributes: { plan: 'string' },
});

type FlagsCtx = {
  Variables: {
    flags: FlagsHandle<FlagSchema>;
    flag: <K extends 'newCheckout' | 'pricingTier'>(key: K) => unknown;
  };
};

const app = new Hono<FlagsCtx>();

app.use(
  '*',
  honoFlags(flags, {
    extractSubject: (c) => {
      const userId = c.req.raw.headers.get('x-user-id');
      const plan = c.req.raw.headers.get('x-user-plan') ?? 'free';
      return userId !== null ? { id: userId, attributes: { plan } } : undefined;
    },
  }),
);

app.get('/checkout', (c) =>
  c.json({
    enabled: c.var.flag('newCheckout'),
    tier: c.var.flag('pricingTier'),
  }),
);

app.get('/health', (c) => c.json({ ok: true, snapshotVersion: c.var.flags.version() }));

const requests = [
  ['anonymous', new Request('http://local/checkout')],
  [
    'user_42 (free)',
    new Request('http://local/checkout', { headers: { 'x-user-id': 'user_42', 'x-user-plan': 'free' } }),
  ],
  [
    'user_42 (pro)',
    new Request('http://local/checkout', { headers: { 'x-user-id': 'user_42', 'x-user-plan': 'pro' } }),
  ],
  [
    'user_999 (free)',
    new Request('http://local/checkout', { headers: { 'x-user-id': 'user_999', 'x-user-plan': 'free' } }),
  ],
] as const;

for (const [label, request] of requests) {
  const response = await app.fetch(request);
  const body = await response.json();
  console.log(`GET /checkout  ${label.padEnd(18)} → ${JSON.stringify(body)}`);
}

const health = await (await app.fetch(new Request('http://local/health'))).json();
console.log(`GET /health                          → ${JSON.stringify(health)}`);
