import type { AiStatusReport } from '../ai/llm.types.js';
import type { AdminHealthDto } from './admin-overview.dto.js';

export interface HealthProbes {
  databaseReachable: () => Promise<boolean>;
  activePolicyVersion: () => Promise<string>;
  stuckCount: () => Promise<number>;
  ai: () => AiStatusReport;
}

/** Detailed health for admins. Never throws; probe failures are reported as values. */
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
