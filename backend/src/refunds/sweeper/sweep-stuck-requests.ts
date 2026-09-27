import { Logger } from '@nestjs/common';
import { and, asc, eq, lt } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';
import { refundRequests } from '../../database/schema/index.js';
import { decideRequest } from '../submission/decide-request.js';
import { reclaimExpiredLease } from '../submission/reclaim-expired-lease.js';
import { escalateAfterSystemFailure } from './escalate-after-system-failure.js';
import type { SweepResult } from './sweep-result.types.js';

export const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 20;
const logger = new Logger('RequestSweeper');

/**
 * One pass over requests stuck in PROCESSING (lease expired: the worker crashed, lost the
 * database, or its decision failed). Each is taken over with the same compare-and-set as a
 * customer retry, so several sweepers or a sweeper and a retry never both process one request.
 * Attempts 2–3 re-run the normal decision; after that a person gets it (SYSTEM_PROCESSING_FAILURE).
 */
export async function sweepStuckRequests(db: Database, options: { minConfidence: number; now?: Date }): Promise<SweepResult> {
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
      if (await decideRequest(db, request.id, leaseOwner, { minConfidence: options.minConfidence })) result.decided++;
    } catch (error) {
      result.retryLater++;
      logger.warn(`Attempt ${attempts} for request ${request.id} failed: ${(error as Error).message}`);
    }
  }
  return result;
}
