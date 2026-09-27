import { Logger } from '@nestjs/common';
import pg from 'pg';

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
