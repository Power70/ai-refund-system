import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';

export interface ReasonCount {
  reason: string;
  count: number;
}

/** How often each escalation reason occurs across all escalations, most common first. */
export async function countEscalationReasons(db: Database, limit = 10): Promise<ReasonCount[]> {
  const result = await db.execute<{ reason: string; count: number }>(sql`
    select reason, count(*)::int as count
    from decisions, unnest(escalation_reasons) as reason
    where status = 'ESCALATED'
    group by reason
    order by count desc, reason asc
    limit ${limit}
  `);
  return result.rows.map((r) => ({ reason: r.reason, count: r.count }));
}
