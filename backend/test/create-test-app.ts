import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { LLM_ADAPTER, LLM_CONFIG } from '../src/ai/llm.service.js';
import type { LlmConfigResult } from '../src/ai/llm-providers.js';
import type { LlmAdapter } from '../src/ai/llm.types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/common/configure-app.js';
import { createPgPool } from '../src/database/create-pg-pool.js';
import { PG_POOL } from '../src/database/database.tokens.js';
import { POLICY_FILE_PATH } from '../src/policy/registry/policy-file-path.token.js';
import { SWEEPER_INTERVAL_MS } from '../src/refunds/sweeper/sweeper-interval.token.js';

export interface TestAppOptions {
  /** Defaults to the real policy/refund-policy.yaml. */
  policyFilePath?: string;
  /** 0 (default) keeps the background sweeper off; tests call it directly. */
  sweeperIntervalMs?: number;
  /** Enables AI with this adapter (e.g. FakeLlm); otherwise AI follows the environment. */
  llm?: LlmAdapter;
}

const FAKE_LLM_CONFIG: LlmConfigResult = {
  enabled: true,
  config: { provider: 'openai-compatible', protocol: 'openai', baseUrl: 'http://fake-llm.invalid', model: 'fake-model', apiKey: 'fake-key', timeoutMs: 5_000 },
};

const REAL_POLICY = new URL('../../policy/refund-policy.yaml', import.meta.url).pathname;

/** Boots the real AppModule with production HTTP configuration against the given database. */
export async function createTestApp(databaseUrl: string, options: TestAppOptions = {}): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.llm) builder = builder.overrideProvider(LLM_CONFIG).useValue(FAKE_LLM_CONFIG).overrideProvider(LLM_ADAPTER).useValue(options.llm);
  const moduleRef = await builder
    .overrideProvider(PG_POOL)
    .useValue(createPgPool(databaseUrl))
    .overrideProvider(POLICY_FILE_PATH)
    .useValue(options.policyFilePath ?? REAL_POLICY)
    .overrideProvider(SWEEPER_INTERVAL_MS)
    .useValue(options.sweeperIntervalMs ?? 0)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  try {
    await app.init();
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
  return app;
}
