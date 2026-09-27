import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Satisfies startup config validation; each suite points the pool at its own test database.
    env: { DATABASE_URL: 'postgresql://unused@127.0.0.1:1/unused' },
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
