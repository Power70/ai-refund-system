import { and, eq, lt, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';
import { refundRequests } from '../../database/schema/index.js';

/** Requests still PROCESSING after their lease ran out. Healthy value: 0 (shown on admin health). */
export async function countStuckRequests(db: Database, now = new Date()): Promise<number> {
  const [{ stuck }] = await db
    .select({ stuck: sql<number>`count(*)::int` })
    .from(refundRequests)
    .where(and(eq(refundRequests.state, 'PROCESSING'), lt(refundRequests.leaseExpiresAt, now)));
  return stuck;
}
