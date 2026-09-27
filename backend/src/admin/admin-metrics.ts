import { eq, gte, sql, type SQL } from 'drizzle-orm';
import type { AiStatusReport } from '../ai/llm.types.js';
import type { Database } from '../database/database.types.js';
import { decisions, refundRequests, reviewResolutions } from '../database/schema/index.js';
import { countStuckRequests } from '../refunds/sweeper/count-stuck-requests.js';
import type { AdminMetricsDto, EscalationReasonCountDto } from './admin-overview.dto.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_REASONS = 10;

/** Dashboard counters, including seeded demo history. */
export async function loadAdminMetrics(db: Database, ai: AiStatusReport, now = new Date()): Promise<AdminMetricsDto> {
  const [counts, topEscalationReasons, stuckProcessingCount] = await Promise.all([
    countRequests(db, now),
    countEscalationReasons(db),
    countStuckRequests(db, now),
  ]);
  const { resolvedApproved, resolvedPartiallyApproved, resolvedDenied, ...requests } = counts;
  return {
    generatedAt: now.toISOString(),
    requests,
    resolutions: { approved: resolvedApproved, partiallyApproved: resolvedPartiallyApproved, denied: resolvedDenied },
    topEscalationReasons,
    stuckProcessingCount,
    ai,
  };
}

async function countRequests(db: Database, now: Date) {
  const where = (condition: SQL) => sql<number>`(count(*) filter (where ${condition}))::int`;
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      last24Hours: where(gte(refundRequests.createdAt, new Date(now.getTime() - DAY_MS))),
      processing: where(sql`${decisions.id} is null`),
      approved: where(sql`${decisions.status} = 'APPROVED'`),
      denied: where(sql`${decisions.status} = 'DENIED'`),
      escalated: where(sql`${decisions.status} = 'ESCALATED'`),
      awaitingReview: where(sql`${decisions.status} = 'ESCALATED' and ${reviewResolutions.id} is null`),
      resolvedApproved: where(sql`${reviewResolutions.outcome} = 'APPROVED'`),
      resolvedPartiallyApproved: where(sql`${reviewResolutions.outcome} = 'PARTIALLY_APPROVED'`),
      resolvedDenied: where(sql`${reviewResolutions.outcome} = 'DENIED'`),
    })
    .from(refundRequests)
    .leftJoin(decisions, eq(decisions.requestId, refundRequests.id))
    .leftJoin(reviewResolutions, eq(reviewResolutions.requestId, refundRequests.id));
  return row;
}

async function countEscalationReasons(db: Database): Promise<EscalationReasonCountDto[]> {
  const result = await db.execute<{ reason: string; count: number }>(sql`
    select reason, count(*)::int as count
    from decisions, unnest(escalation_reasons) as reason
    where status = 'ESCALATED'
    group by reason
    order by count desc, reason asc
    limit ${TOP_REASONS}
  `);
  return result.rows.map(({ reason, count }) => ({ reason, count }));
}
