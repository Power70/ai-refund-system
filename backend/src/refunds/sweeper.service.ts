import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, lt } from 'drizzle-orm';
import { runWithCorrelation } from '../common/correlation.js';
import { DATABASE, type Database } from '../database/database.providers.js';
import { refundRequests } from '../database/schema.js';
import { SessionsService } from '../auth/sessions.service.js';
import { DecisionService } from './decision.service.js';

/** Injection token: sweep interval in ms; 0 disables the timer (tests call `sweepOnce`). */
export const SWEEPER_INTERVAL_MS = Symbol('SWEEPER_INTERVAL_MS');

/** Processing attempts before a request is handed to a person. */
export const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 20;

export interface SweepResult {
  found: number;
  decided: number;
  /** Escalated after exceeding MAX_ATTEMPTS. */
  escalated: number;
  /** Failed again; retried once the new lease expires. */
  retryLater: number;
}

/**
 * Recovers requests left PROCESSING after their lease expired. Takeover uses the same
 * compare-and-set as a customer retry, so no request is processed twice concurrently.
 */
@Injectable()
export class SweeperService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SweeperService.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<SweepResult | null> | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SWEEPER_INTERVAL_MS) private readonly intervalMs: number,
    private readonly decisions: DecisionService,
    private readonly sessions: SessionsService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running; // let an in-flight pass finish before the pool closes
  }

  /** Timer entry point; passes never overlap. Also purges expired sessions. */
  sweep(): Promise<SweepResult | null> {
    this.running ??= runWithCorrelation(`sweep-${randomUUID()}`, async () => {
      await this.sessions.purgeExpired();
      return this.sweepOnce();
    })
      .then((result) => {
        if (result.found > 0) this.logger.log(`Swept ${result.found}: ${result.decided} decided, ${result.escalated} escalated, ${result.retryLater} to retry`);
        return result;
      })
      .catch((error: unknown) => {
        this.logger.error(`Sweep failed: ${(error as Error).message}`);
        return null;
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  /** Retries the normal decision up to MAX_ATTEMPTS, then escalates (SYSTEM_PROCESSING_FAILURE). */
  async sweepOnce(now = new Date()): Promise<SweepResult> {
    const stuck = await this.findStuck(now);
    const result: SweepResult = { found: stuck.length, decided: 0, escalated: 0, retryLater: 0 };

    for (const request of stuck) {
      const leaseOwner = await this.decisions.reclaimExpiredLease(request.id, now);
      if (!leaseOwner) continue; // reclaimed by another caller

      const attempts = request.attemptCount + 1;
      if (attempts > MAX_ATTEMPTS) {
        if (await this.decisions.escalateAfterSystemFailure(request.id, leaseOwner, request.attemptCount)) result.escalated++;
        continue;
      }
      try {
        if (await this.decisions.decide(request.id, leaseOwner)) result.decided++;
      } catch (error) {
        result.retryLater++;
        this.logger.warn(`Attempt ${attempts} for request ${request.id} failed: ${(error as Error).message}`);
      }
    }
    return result;
  }

  protected findStuck(now: Date): Promise<{ id: string; attemptCount: number }[]> {
    return this.db
      .select({ id: refundRequests.id, attemptCount: refundRequests.attemptCount })
      .from(refundRequests)
      .where(and(eq(refundRequests.state, 'PROCESSING'), lt(refundRequests.leaseExpiresAt, now)))
      .orderBy(asc(refundRequests.leaseExpiresAt))
      .limit(BATCH_SIZE);
  }
}
