/**
 * @devkit/flags — Express integration (StackBlitz sandbox).
 *
 * Run:  npm start
 *
 * Demonstrates:
 *  - registering `expressFlags(flags)` as global middleware
 *  - reading `req.flag(key)` and `req.flags` inside route handlers
 *  - layering an env-var source so `FLAG_*` env-vars override defaults
 *    without redeploying — `FLAG_NEW_CHECKOUT=true npx tsx examples/with-express.ts`
 *  - making real HTTP requests against a short-lived server so the
 *    example is self-contained and exits cleanly
 */

import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

import express from 'express';

import { defineFlags } from '@devkit/flags';
import { createEnvSource } from '@devkit/flags/sources/env';
import { expressFlags } from '@devkit/flags/adapters/express';

const flags = defineFlags({
  flags: {
    newCheckout: { kind: 'boolean', default: false, rollout: { percentage: 25 } },
    apiVersion: {
      kind: 'string',
      default: 'v1',
      values: ['v1', 'v2'] as const,
    },
  },
  sources: [createEnvSource()],
});

await flags.ready();

const app = express();
app.use(expressFlags(flags));

app.get('/api/checkout', (req, res) => {
  // `req.flag` is added by the middleware. Cast for example clarity —
  // the @devkit/flags/adapters/express types attach this declaratively
  // when the user augments `Express.Request` in their own .d.ts.
  const r = req as typeof req & { flag: (k: 'newCheckout' | 'apiVersion') => unknown };
  res.json({ enabled: r.flag('newCheckout'), api: r.flag('apiVersion') });
});

const server: Server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

async function call(path: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(`${base}${path}`, { headers });
  return response.json();
}

const subjects = [
  { label: 'anonymous', cookie: undefined },
  { label: 'alice', cookie: 'devkit-flags-subject=alice' },
  { label: 'bob', cookie: 'devkit-flags-subject=bob' },
  { label: 'carol', cookie: 'devkit-flags-subject=carol' },
  { label: 'dave', cookie: 'devkit-flags-subject=dave' },
  { label: 'erin', cookie: 'devkit-flags-subject=erin' },
];

console.log(`server listening on ${base}`);
for (const { label, cookie } of subjects) {
  const headers = cookie !== undefined ? { cookie } : {};
  const body = await call('/api/checkout', headers);
  console.log(`GET /api/checkout  ${label.padEnd(10)} → ${JSON.stringify(body)}`);
}

if (process.env.FLAG_NEW_CHECKOUT !== undefined || process.env.FLAG_API_VERSION !== undefined) {
  console.log('\n(env-var overrides detected — values above reflect the env-source overlay)');
} else {
  console.log('\nTip: set FLAG_NEW_CHECKOUT=true or FLAG_API_VERSION=v2 to flip values without redeploying.');
}

server.close();
await flags.dispose();
