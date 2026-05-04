/**
 * basic-usage.ts — minimal core functionality.
 *
 * Run:  npx tsx examples/basic-usage.ts
 *
 * Demonstrates:
 *  - declaring a typed flag schema with `defineFlags`
 *  - reading boolean / string / number flags with full type narrowing
 *  - per-flag defaults from the spec, per-call fallbacks via the third arg
 *  - the simplest form of percentage rollout, evaluated for a subject
 */

import { defineFlags } from '@devkit/flags';

const flags = defineFlags({
  flags: {
    maintenanceMode: { kind: 'boolean', default: false },
    newCheckout: {
      kind: 'boolean',
      default: false,
      rollout: { percentage: 25 },
    },
    theme: {
      kind: 'string',
      default: 'light',
      values: ['light', 'dark'] as const,
    },
    maxItems: {
      kind: 'number',
      default: 10,
      range: [1, 100],
    },
  },
});

function line(label: string, value: unknown): void {
  console.log(`${label.padEnd(36)} ${JSON.stringify(value)}`);
}

console.log('--- type-narrowed reads from the schema defaults ---');
const maintenance: boolean = flags.get('maintenanceMode');
const theme: 'light' | 'dark' = flags.get('theme');
const maxItems: number = flags.get('maxItems');
line('maintenanceMode (boolean)', maintenance);
line('theme ("light" | "dark")', theme);
line('maxItems (number)', maxItems);

console.log('\n--- 25% rollout: deterministic FNV-1a bucketing per subject ---');
const sampleSize = 1000;
let included = 0;
for (let i = 0; i < sampleSize; i += 1) {
  if (flags.get('newCheckout', { subject: { id: `user_${i}` } })) included += 1;
}
line('share of 1000 synthetic users', `${((included / sampleSize) * 100).toFixed(1)}%`);

console.log('\n--- bucket is stable across calls for the same subject ---');
const subject = { subject: { id: 'user_42' } } as const;
line('user_42 first call', flags.get('newCheckout', subject));
line('user_42 second call', flags.get('newCheckout', subject));

console.log('\n--- getDetail surfaces reason / bucket / source for diagnostics ---');
const detail = flags.getDetail('newCheckout', subject);
line('reason', detail.reason);
line('bucket (0..9999)', detail.bucket);
line('source', detail.source);
