import { randomBytes } from 'node:crypto';
import { defineConfig } from 'vitest/config';

// Generated per run so no password is committed.
const testSecret = () => `T${randomBytes(18).toString('base64url')}`;

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Valid startup config; each suite overrides the pool. AI stays disabled unless a suite injects an adapter.
    // TEST_DATABASE_ADMIN_URL comes from the shell.
    env: {
      DATABASE_URL: 'postgresql://unused@127.0.0.1:1/unused',
      SWEEPER_INTERVAL_MS: '0',
      LLM_API_KEY: '',
      ADMIN_PASSWORD: testSecret(),
      TEST_CUSTOMER_PASSWORD: testSecret(),
    },
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
