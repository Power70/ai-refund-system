import { Logger, Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type * as schema from './schema.js';

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
  // When the database drops an idle connection (restart, failover, network blip) the pool
  // emits 'error'. Without a listener Node treats it as unhandled and crashes the process.
  // The pool discards the broken client and opens a new one on the next query.
  pool.on('error', (error) => {
    logger.warn(`Idle database connection lost: ${error.message}`);
  });
  return pool;
}

const PING_TIMEOUT_MS = 2_000;

@Injectable()
export class DatabaseHealthService {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /** True when the database answers a trivial query within the timeout. Never throws. */
  async isReachable(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS);
    });
    const ping = this.pool.query('SELECT 1').then(
      () => true,
      () => false,
    );
    try {
      return await Promise.race([ping, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
