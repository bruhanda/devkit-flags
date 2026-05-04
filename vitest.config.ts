import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.tsx'],
    environment: 'node',
    typecheck: {
      enabled: false,
      include: ['src/__tests__/**/*.test-d.ts'],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/**/index.ts',
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
