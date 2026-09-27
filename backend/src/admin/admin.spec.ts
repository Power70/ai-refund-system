import type { AiStatusReport } from '../ai/llm.types.js';
import { escapeLike, checkAdminHealth, type HealthProbes } from './admin-queries.js';
import { deriveResolution } from './admin-resolution.js';

describe('escapeLike', () => {
  it('escapes %, _ and backslash', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });
  it('leaves normal text alone', () => {
    expect(escapeLike('ada.okafor@example.com')).toBe('ada.okafor@example.com');
  });
});

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

const lines = [
  { id: 'a', amountMinor: 8000 },
  { id: 'b', amountMinor: 6000 },
];

describe('deriveResolution', () => {
  it('approves everything', () => {
    expect(deriveResolution(lines, [{ lineId: 'b', approve: true }, { lineId: 'a', approve: true }])).toEqual({
      outcome: 'APPROVED',
      approvedAmountMinor: 14000,
      lineDecisions: [{ lineId: 'a', approve: true }, { lineId: 'b', approve: true }],
    });
  });

  it('approves some lines: the total is only the approved lines', () => {
    expect(deriveResolution(lines, [{ lineId: 'a', approve: false }, { lineId: 'b', approve: true }])).toMatchObject({ outcome: 'PARTIALLY_APPROVED', approvedAmountMinor: 6000 });
  });

  it('denies everything with a zero total', () => {
    expect(deriveResolution(lines, [{ lineId: 'a', approve: false }, { lineId: 'b', approve: false }])).toMatchObject({ outcome: 'DENIED', approvedAmountMinor: 0 });
  });

  it.each([
    ['a line is missing', [{ lineId: 'a', approve: true }]],
    ['a line is unknown', [{ lineId: 'a', approve: true }, { lineId: 'x', approve: true }]],
    ['a line appears twice', [{ lineId: 'a', approve: true }, { lineId: 'a', approve: false }, { lineId: 'b', approve: true }]],
    ['an extra line is added', [{ lineId: 'a', approve: true }, { lineId: 'b', approve: true }, { lineId: 'c', approve: true }]],
  ])('rejects decisions when %s', (_, decisions) => {
    expect(deriveResolution(lines, decisions)).toBeNull();
  });

  it('rejects a request with no lines', () => {
    expect(deriveResolution([], [])).toBeNull();
  });
});
