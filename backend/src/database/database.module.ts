import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { Env } from '../config/env.js';
import { createPgPool, DatabaseHealthService, DATABASE, PG_POOL } from './database.js';
import * as schema from './schema.js';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createPgPool(config.get('DATABASE_URL', { infer: true })),
    },
    {
      provide: DATABASE,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool) => drizzle(pool, { schema }),
    },
    DatabaseHealthService,
  ],
  exports: [DATABASE, DatabaseHealthService],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /** Closes connections cleanly on shutdown (SIGTERM from Docker). */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
