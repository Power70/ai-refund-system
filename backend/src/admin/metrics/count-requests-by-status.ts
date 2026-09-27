import { eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';
import { decisions, refundRequests, reviewResolutions } from '../../database/schema/index.js';

export interface StatusCounts {
  total: number;
  last24Hours: number;
  processing: number;
  approved: number;
  denied: number;
  escalated: number;
  /** Escalations still waiting for a person. */
  awaitingReview: number;
  resolvedApproved: number;
  resolvedPartiallyApproved: number;
  resolvedDenied: number;
}

/**
 * One pass over all requests. approved/denied/escalated are the automated decisions;
 * the resolved* counts are what people later decided on escalations.
 */
export async function countRequestsByStatus(db: Database, now: Date): Promise<StatusCounts> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const count = (condition: ReturnType<typeof sql>) => sql<number>`(count(*) filter (where ${condition}))::int`;
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      last24Hours: count(sql`${gte(refundRequests.createdAt, since)}`),
      processing: count(sql`${decisions.id} is null`),
      approved: count(sql`${decisions.status} = 'APPROVED'`),
      denied: count(sql`${decisions.status} = 'DENIED'`),
      escalated: count(sql`${decisions.status} = 'ESCALATED'`),
      awaitingReview: count(sql`${decisions.status} = 'ESCALATED' and ${reviewResolutions.id} is null`),
      resolvedApproved: count(sql`${reviewResolutions.outcome} = 'APPROVED'`),
      resolvedPartiallyApproved: count(sql`${reviewResolutions.outcome} = 'PARTIALLY_APPROVED'`),
      resolvedDenied: count(sql`${reviewResolutions.outcome} = 'DENIED'`),
    })
    .from(refundRequests)
    .leftJoin(decisions, eq(decisions.requestId, refundRequests.id))
    .leftJoin(reviewResolutions, eq(reviewResolutions.requestId, refundRequests.id));
  return row;
}
