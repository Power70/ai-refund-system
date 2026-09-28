import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { DATABASE, databaseProviders, PG_POOL } from './database.providers.js';

@Global()
@Module({
  providers: databaseProviders,
  exports: [DATABASE, PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /** Closes connections on shutdown (SIGTERM from Docker). */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
