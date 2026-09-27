import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/common/configure-app.js';
import { createPgPool } from '../src/database/create-pg-pool.js';
import { PG_POOL } from '../src/database/database.tokens.js';

/** Boots the real AppModule with production HTTP configuration against the given database. */
export async function createTestApp(databaseUrl: string): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL)
    .useValue(createPgPool(databaseUrl))
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();
  return app;
}
