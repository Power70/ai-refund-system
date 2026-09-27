import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { PG_POOL } from './database.tokens.js';

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
