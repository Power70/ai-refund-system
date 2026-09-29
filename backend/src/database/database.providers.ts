import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Env } from '../config/env.js';
import * as schema from './schema.js';

/** Injection tokens for the database layer. */
export const PG_POOL = Symbol('PG_POOL');
export const DATABASE = Symbol('DATABASE');

export type Database = NodePgDatabase<typeof schema>;

/**
 * Extracts the PostgreSQL SQLSTATE code (e.g. "23505" unique violation) from an error,
 * whether it came straight from node-postgres or wrapped by Drizzle.
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** True when the error is a unique-constraint violation (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23505';
}

const logger = new Logger('PgPool');

/** Connection pool with bounded waits, so a stuck database fails fast instead of hanging requests. */
export function createPgPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    application_name: 'ai-refund-api',
  });
  // A dropped idle connection emits 'error' on the pool; unhandled, it would crash the process.
  // The pool replaces the broken client on the next query.
  pool.on('error', (error) => {
    logger.warn(`Idle database connection lost: ${error.message}`);
  });
  return pool;
}

export const databaseProviders: Provider[] = [
  {
    provide: PG_POOL,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>) => createPgPool(config.get('DATABASE_URL', { infer: true })),
  },
  {
    provide: DATABASE,
    inject: [PG_POOL],
    useFactory: (pool: pg.Pool): Database => drizzle(pool, { schema }),
  },
];
