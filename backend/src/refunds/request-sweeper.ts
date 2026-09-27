import { Logger, Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, lt, sql, asc } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { DATABASE, type Database } from '../database/database.js';
import { refundRequests, auditEvents, decisions, refundRequestLines } from '../database/schema.js';
import { LlmService } from '../ai/llm.service.js';
import { decideRequest } from './decide-request.js';
import { SYSTEM_FAILURE_CUSTOMER_MESSAGE } from './refund-messages.js';
import { reclaimExpiredLease } from './refund-requests.js';

/** How often the sweeper runs, in ms; 0 turns it off (tests drive it directly). */
export const SWEEPER_INTERVAL_MS = Symbol('SWEEPER_INTERVAL_MS');

export interface SweepResult {
  /** Stuck requests found. */
  found: number;
  /** Decided normally on this pass. */
  decided: number;
  /** Handed to a person after too many failed attempts. */
  escalated: number;
  /** Still not finished (will be retried once the new lease expires). */
  retryLater: number;
}

/** Requests still PROCESSING after their lease ran out. Healthy value: 0 (shown on admin health). */
export async function countStuckRequests(db: Database, now = new Date()): Promise<number> {
  const [{ stuck }] = await db
    .select({ stuck: sql<number>`count(*)::int` })
    .from(refundRequests)
    .where(and(eq(refundRequests.state, 'PROCESSING'), lt(refundRequests.leaseExpiresAt, now)));
  return stuck;
}

/**
 * Last resort after repeated processing failures: hand the request to a person instead of
 * leaving it stuck. Written only while `leaseOwner` holds the lease (same rule as a normal decision).
 * The rules never ran, so there is no rule trace; every line stays reserved for the reviewer.
 */
export async function escalateAfterSystemFailure(db: Database, requestId: string, leaseOwner: string, attempts: number): Promise<boolean> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(refundRequests)
      .set({ state: 'DECIDED', leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
      .where(and(eq(refundRequests.id, requestId), eq(refundRequests.state, 'PROCESSING'), eq(refundRequests.leaseOwner, leaseOwner)))
      .returning({ policyVersionId: refundRequests.policyVersionId });
    if (claimed.length === 0) return false;

    await tx.insert(decisions).values({
      requestId,
      status: 'ESCALATED',
      approvedAmountMinor: 0,
      policyVersionId: claimed[0].policyVersionId,
      ruleTrace: null,
      escalationReasons: ['SYSTEM_PROCESSING_FAILURE'],
      customerMessage: SYSTEM_FAILURE_CUSTOMER_MESSAGE,
      messageSource: 'TEMPLATE',
      createdAt: now,
    });
    await tx.update(refundRequestLines).set({ finalLineStatus: 'UNDER_REVIEW' }).where(eq(refundRequestLines.requestId, requestId));
    await tx.insert(auditEvents).values([
      { requestId, type: 'SYSTEM_PROCESSING_FAILED', actor: 'SYSTEM', data: { attempts }, createdAt: now },
      { requestId, type: 'DECISION_RECORDED', actor: 'SYSTEM', data: { status: 'ESCALATED', reason: 'SYSTEM_PROCESSING_FAILURE' }, createdAt: now },
    ]);
    return true;
  });
}

export const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 20;
const logger = new Logger('RequestSweeper');

/**
 * One pass over requests stuck in PROCESSING (lease expired: the worker crashed, lost the
 * database, or its decision failed). Each is taken over with the same compare-and-set as a
 * customer retry, so several sweepers or a sweeper and a retry never both process one request.
 * Attempts 2–3 re-run the normal decision; after that a person gets it (SYSTEM_PROCESSING_FAILURE).
 */
export async function sweepStuckRequests(db: Database, options: { minConfidence: number; llm?: LlmService; now?: Date }): Promise<SweepResult> {
  const now = options.now ?? new Date();
  const stuck = await db
    .select({ id: refundRequests.id, attemptCount: refundRequests.attemptCount })
    .from(refundRequests)
    .where(and(eq(refundRequests.state, 'PROCESSING'), lt(refundRequests.leaseExpiresAt, now)))
    .orderBy(asc(refundRequests.leaseExpiresAt))
    .limit(BATCH_SIZE);

  const result: SweepResult = { found: stuck.length, decided: 0, escalated: 0, retryLater: 0 };
  for (const request of stuck) {
    const leaseOwner = await reclaimExpiredLease(db, request.id, now);
    if (!leaseOwner) continue; // someone else took it over first

    const attempts = request.attemptCount + 1;
    if (attempts > MAX_ATTEMPTS) {
      if (await escalateAfterSystemFailure(db, request.id, leaseOwner, request.attemptCount)) result.escalated++;
      continue;
    }
    try {
      if (await decideRequest(db, request.id, leaseOwner, { minConfidence: options.minConfidence, llm: options.llm })) result.decided++;
    } catch (error) {
      result.retryLater++;
      logger.warn(`Attempt ${attempts} for request ${request.id} failed: ${(error as Error).message}`);
    }
  }
  return result;
}

/** Runs the sweep on a timer. Passes never overlap; a failed pass is logged and retried next tick. */
@Injectable()
export class RequestSweeperService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RequestSweeperService.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<SweepResult | null> | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SWEEPER_INTERVAL_MS) private readonly intervalMs: number,
    private readonly config: ConfigService<Env, true>,
    private readonly llm: LlmService,
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

  sweep(): Promise<SweepResult | null> {
    if (this.running) return this.running;
    this.running = sweepStuckRequests(this.db, { minConfidence: this.config.get('AI_MIN_CONFIDENCE', { infer: true }), llm: this.llm })
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
}
