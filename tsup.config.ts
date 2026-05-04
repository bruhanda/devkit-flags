import { defineConfig } from 'tsup';

const SHARED = {
  format: ['esm'] as const,
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: true,
  splitting: false,
  target: 'es2022' as const,
  external: [
    'react',
    'react-dom',
    'next',
    '@sveltejs/kit',
    'vue',
    'hono',
    'express',
    '@openfeature/server-sdk',
  ],
};

export default defineConfig({
  ...SHARED,
  entry: {
    index: 'src/index.ts',
    'errors/index': 'src/errors/index.ts',
    'types/index': 'src/types/index.ts',
    'matchers/extended/index': 'src/matchers/extended/index.ts',
    'validators/standard-schema/index': 'src/validators/standard-schema/index.ts',
    'sources/json/index': 'src/sources/json/index.ts',
    'sources/env/index': 'src/sources/env/index.ts',
    'sources/remote/index': 'src/sources/remote/index.ts',
    'sources/compose/index': 'src/sources/compose/index.ts',
    'adapters/react/index': 'src/adapters/react/index.ts',
    'adapters/next/index': 'src/adapters/next/index.ts',
    'adapters/sveltekit/index': 'src/adapters/sveltekit/index.ts',
    'adapters/vue/index': 'src/adapters/vue/index.ts',
    'adapters/hono/index': 'src/adapters/hono/index.ts',
    'adapters/express/index': 'src/adapters/express/index.ts',
    'adapters/openfeature/index': 'src/adapters/openfeature/index.ts',
    'observe/index': 'src/observe/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
});
