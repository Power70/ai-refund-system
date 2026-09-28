import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import type pg from 'pg';
import { LlmService } from '../ai/llm.service.js';
import { DATABASE, PG_POOL, type Database } from '../database/database.providers.js';
import { refundRequests } from '../database/schema.js';
import { PolicyService } from '../policy/policy.service.js';
import type { DetailedHealthDto } from './dto/health.dto.js';

const PING_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(DATABASE) private readonly db: Database,
    private readonly policies: PolicyService,
    private readonly llm: LlmService,
  ) {}

  /** True when the database answers a trivial query within the timeout. Never throws. */
  async isDatabaseReachable(): Promise<boolean> {
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

  /** Requests still PROCESSING after their lease expired. Expected to be 0. */
  async countStuckRequests(now = new Date()): Promise<number> {
    const [{ stuck }] = await this.db
      .select({ stuck: sql<number>`count(*)::int` })
      .from(refundRequests)
      .where(and(eq(refundRequests.state, 'PROCESSING'), lt(refundRequests.leaseExpiresAt, now)));
    return stuck;
  }

  /** Detailed status for admins. Never throws; failing checks are reported as values. */
  async detailed(now = new Date()): Promise<DetailedHealthDto> {
    const ai = this.llm.report();
    const reachable = await this.isDatabaseReachable();
    const [policyVersion, stuckProcessingCount] = reachable
      ? await Promise.all([
          this.policies.activePolicy().then((p) => p.version, () => null),
          this.countStuckRequests(now).catch(() => null),
        ])
      : [null, null];

    const healthy = reachable && ai.status !== 'degraded' && policyVersion !== null && stuckProcessingCount === 0;
    return {
      status: healthy ? 'ok' : 'degraded',
      database: reachable ? 'ok' : 'unreachable',
      ai,
      policyVersion,
      stuckProcessingCount,
      checkedAt: now.toISOString(),
    };
  }
}
