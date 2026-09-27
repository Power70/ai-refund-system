import type { AiStatusReport } from '../../ai/ai-status.types.js';
import type { AdminHealthDto } from './dto/admin-health.dto.js';

export interface HealthProbes {
  databaseReachable: () => Promise<boolean>;
  activePolicyVersion: () => Promise<string>;
  stuckCount: () => Promise<number>;
  ai: () => AiStatusReport;
}

/**
 * Detailed status for admins. Never throws: a failing probe shows up as a value.
 * AI "disabled" is a supported way to run the demo, so it doesn't count as degraded.
 */
export async function checkAdminHealth(probes: HealthProbes, now = new Date()): Promise<AdminHealthDto> {
  const ai = probes.ai();
  const reachable = await probes.databaseReachable();
  const [policyVersion, stuckProcessingCount] = reachable
    ? await Promise.all([probes.activePolicyVersion().catch(() => null), probes.stuckCount().catch(() => null)])
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
