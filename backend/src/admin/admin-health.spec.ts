import type { AiStatusReport } from '../ai/llm.types.js';
import { checkAdminHealth, type HealthProbes } from './admin-health.js';

const disabled: AiStatusReport = { status: 'disabled', provider: null, model: null, lastError: null };
const probes = (overrides: Partial<HealthProbes> = {}): HealthProbes => ({
  databaseReachable: async () => true,
  activePolicyVersion: async () => '2026.09-1',
  stuckCount: async () => 0,
  ai: () => disabled,
  ...overrides,
});
const now = new Date('2026-09-27T12:00:00Z');

describe('checkAdminHealth', () => {
  it('is ok with AI disabled', async () => {
    expect(await checkAdminHealth(probes(), now)).toEqual({
      status: 'ok', database: 'ok', ai: disabled, policyVersion: '2026.09-1', stuckProcessingCount: 0, checkedAt: '2026-09-27T12:00:00.000Z',
    });
  });

  it('is degraded when requests are stuck', async () => {
    expect(await checkAdminHealth(probes({ stuckCount: async () => 2 }), now)).toMatchObject({ status: 'degraded', stuckProcessingCount: 2 });
  });

  it('is degraded when the AI provider is failing', async () => {
    const ai: AiStatusReport = { status: 'degraded', provider: 'openai', model: 'gpt-5-mini', lastError: 'auth' };
    expect(await checkAdminHealth(probes({ ai: () => ai }), now)).toMatchObject({ status: 'degraded', ai });
  });

  it('skips database queries when the database is unreachable', async () => {
    const stuckCount = vi.fn(async () => 0);
    expect(await checkAdminHealth(probes({ databaseReachable: async () => false, stuckCount }), now)).toMatchObject({
      status: 'degraded', database: 'unreachable', policyVersion: null, stuckProcessingCount: null,
    });
    expect(stuckCount).not.toHaveBeenCalled();
  });

  it('reports failing queries as null', async () => {
    const boom = async (): Promise<never> => { throw new Error('boom'); };
    expect(await checkAdminHealth(probes({ activePolicyVersion: boom, stuckCount: boom }), now)).toMatchObject({
      status: 'degraded', database: 'ok', policyVersion: null, stuckProcessingCount: null,
    });
  });
});
