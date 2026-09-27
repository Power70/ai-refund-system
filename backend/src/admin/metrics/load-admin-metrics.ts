import type { AiStatusReport } from '../../ai/ai-status.types.js';
import type { Database } from '../../database/database.types.js';
import { countStuckRequests } from '../../refunds/sweeper/count-stuck-requests.js';
import type { AdminMetricsDto } from './dto/admin-metrics.dto.js';
import { countEscalationReasons } from './count-escalation-reasons.js';
import { countRequestsByStatus } from './count-requests-by-status.js';

/** Numbers for the dashboard tiles. Includes the seeded demo history. */
export async function loadAdminMetrics(db: Database, ai: AiStatusReport, now = new Date()): Promise<AdminMetricsDto> {
  const [counts, topEscalationReasons, stuckProcessingCount] = await Promise.all([
    countRequestsByStatus(db, now),
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
