import { and, eq, lt, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';
import { auditEvents, refundRequests } from '../../database/schema/index.js';
import { newLease } from './new-lease.js';

/**
 * Takes over a request whose worker died (lease expired) with one compare-and-set UPDATE.
 * If two callers race (a retry and the sweeper), exactly one gets the lease; the other gets null.
 */
export async function reclaimExpiredLease(db: Database, requestId: string, now = new Date()): Promise<string | null> {
  const lease = newLease(now);
  const [row] = await db
    .update(refundRequests)
    .set({ ...lease, attemptCount: sql`${refundRequests.attemptCount} + 1`, updatedAt: now })
    .where(and(eq(refundRequests.id, requestId), eq(refundRequests.state, 'PROCESSING'), lt(refundRequests.leaseExpiresAt, now)))
    .returning({ attemptCount: refundRequests.attemptCount });
  if (!row) return null;
  await db.insert(auditEvents).values({ requestId, type: 'PROCESSING_RESUMED', actor: 'SYSTEM', data: { attempt: row.attemptCount }, createdAt: now });
  return lease.leaseOwner;
}
