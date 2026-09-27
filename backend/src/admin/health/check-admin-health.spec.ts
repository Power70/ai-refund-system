import type { AiStatusReport } from '../../ai/ai-status.types.js';
import { checkAdminHealth, type HealthProbes } from './check-admin-health.js';

const disabled: AiStatusReport = { status: 'disabled', provider: null, model: null };
const probes = (overrides: Partial<HealthProbes> = {}): HealthProbes => ({
  databaseReachable: async () => true,
  activePolicyVersion: async () => '2026.09-1',
  stuckCount: async () => 0,
  ai: () => disabled,
  ...overrides,
});
const now = new Date('2026-09-27T12:00:00Z');

describe('checkAdminHealth', () => {
  it('is ok with AI disabled, since that is a supported mode', async () => {
    expect(await checkAdminHealth(probes(), now)).toEqual({
      status: 'ok', database: 'ok', ai: disabled, policyVersion: '2026.09-1', stuckProcessingCount: 0, checkedAt: '2026-09-27T12:00:00.000Z',
    });
  });

  it('is degraded when requests are stuck', async () => {
    expect(await checkAdminHealth(probes({ stuckCount: async () => 2 }), now)).toMatchObject({ status: 'degraded', stuckProcessingCount: 2 });
  });

  it('is degraded when the AI provider is failing', async () => {
    const ai = { status: 'degraded', provider: 'openai', model: 'gpt-x' } as const;
    expect(await checkAdminHealth(probes({ ai: () => ai }), now)).toMatchObject({ status: 'degraded', ai });
  });

  it('reports an unreachable database without querying it further', async () => {
    const stuckCount = vi.fn(async () => 0);
    expect(await checkAdminHealth(probes({ databaseReachable: async () => false, stuckCount }), now)).toMatchObject({
      status: 'degraded', database: 'unreachable', policyVersion: null, stuckProcessingCount: null,
    });
    expect(stuckCount).not.toHaveBeenCalled();
  });

  it('turns a failing query into a value instead of an error', async () => {
    const failing = probes({ activePolicyVersion: async () => { throw new Error('boom'); }, stuckCount: async () => { throw new Error('boom'); } });
    expect(await checkAdminHealth(failing, now)).toMatchObject({ status: 'degraded', database: 'ok', policyVersion: null, stuckProcessingCount: null });
  });
});
