import type pg from 'pg';
import type { LlmService } from '../ai/llm.service.js';
import type { AiStatusReport } from '../ai/llm.types.js';
import type { Database } from '../database/database.providers.js';
import type { PolicyService } from '../policy/policy.service.js';
import { HealthService } from './health.service.js';

const disabled: AiStatusReport = { status: 'disabled', provider: null, model: null, lastError: null };
const now = new Date('2026-09-27T12:00:00Z');

function setup(options: { ping?: () => Promise<unknown>; policy?: () => Promise<unknown>; stuck?: number | Error; ai?: AiStatusReport } = {}) {
  const pool = { query: vi.fn(options.ping ?? (async () => ({ rows: [] }))) };
  const policies = { activePolicy: vi.fn(options.policy ?? (async () => ({ version: '2026.09-1' }))) };
  const llm = { report: vi.fn(() => options.ai ?? disabled) };
  const service = new HealthService(pool as unknown as pg.Pool, {} as Database, policies as unknown as PolicyService, llm as unknown as LlmService);
  const stuck = vi.spyOn(service, 'countStuckRequests');
  if (options.stuck instanceof Error) stuck.mockRejectedValue(options.stuck);
  else stuck.mockResolvedValue(options.stuck ?? 0);
  return { service, pool, stuck };
}

describe('HealthService', () => {
  it('pings the database, never throwing', async () => {
    await expect(setup().service.isDatabaseReachable()).resolves.toBe(true);
    await expect(setup({ ping: async () => Promise.reject(new Error('down')) }).service.isDatabaseReachable()).resolves.toBe(false);
  });

  it('is ok with the database up, a policy in force, nothing stuck and AI disabled', async () => {
    await expect(setup().service.detailed(now)).resolves.toEqual({
      status: 'ok', database: 'ok', ai: disabled, policyVersion: '2026.09-1', stuckProcessingCount: 0, checkedAt: '2026-09-27T12:00:00.000Z',
    });
  });

  it('is degraded when requests are stuck', async () => {
    await expect(setup({ stuck: 2 }).service.detailed(now)).resolves.toMatchObject({ status: 'degraded', stuckProcessingCount: 2 });
  });

  it('is degraded when the AI provider is failing', async () => {
    const ai: AiStatusReport = { status: 'degraded', provider: 'openai', model: 'gpt-5-mini', lastError: 'auth' };
    await expect(setup({ ai }).service.detailed(now)).resolves.toMatchObject({ status: 'degraded', ai });
  });

  it('skips database checks when the database is unreachable', async () => {
    const { service, stuck } = setup({ ping: async () => Promise.reject(new Error('down')) });
    await expect(service.detailed(now)).resolves.toMatchObject({ status: 'degraded', database: 'unreachable', policyVersion: null, stuckProcessingCount: null });
    expect(stuck).not.toHaveBeenCalled();
  });

  it('reports failing checks as null', async () => {
    const { service } = setup({ policy: async () => Promise.reject(new Error('boom')), stuck: new Error('boom') });
    await expect(service.detailed(now)).resolves.toMatchObject({ status: 'degraded', database: 'ok', policyVersion: null, stuckProcessingCount: null });
  });
});
