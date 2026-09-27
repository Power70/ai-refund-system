import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Valid startup config; each suite overrides the pool. AI stays disabled unless a suite injects an adapter.
    env: { DATABASE_URL: 'postgresql://unused@127.0.0.1:1/unused', SWEEPER_INTERVAL_MS: '0', LLM_API_KEY: '' },
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
