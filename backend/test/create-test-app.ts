import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/common/configure-app.js';
import { createPgPool } from '../src/database/create-pg-pool.js';
import { PG_POOL } from '../src/database/database.tokens.js';
import { POLICY_FILE_PATH } from '../src/policy/registry/policy-file-path.token.js';

export interface TestAppOptions {
  /** Defaults to the real policy/refund-policy.yaml. */
  policyFilePath?: string;
}

const REAL_POLICY = new URL('../../policy/refund-policy.yaml', import.meta.url).pathname;

/** Boots the real AppModule with production HTTP configuration against the given database. */
export async function createTestApp(databaseUrl: string, options: TestAppOptions = {}): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL)
    .useValue(createPgPool(databaseUrl))
    .overrideProvider(POLICY_FILE_PATH)
    .useValue(options.policyFilePath ?? REAL_POLICY)
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
