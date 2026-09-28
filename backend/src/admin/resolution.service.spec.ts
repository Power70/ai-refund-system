import type { Database } from '../database/database.providers.js';
import { deriveResolution, ResolutionService } from './resolution.service.js';

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

describe('ResolutionService.resolve', () => {
  const input = { lineDecisions: [{ lineId: 'a', approve: true }], reviewerNote: 'Checked.' };

  it('reports a lost race on the unique constraint as ALREADY_RESOLVED', async () => {
    const db = { transaction: vi.fn(async () => Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }))) };
    await expect(new ResolutionService(db as unknown as Database).resolve('rr_abcdefghjkmn', input)).rejects.toMatchObject({ code: 'ALREADY_RESOLVED', status: 409 });
  });

  it('passes other failures through unchanged', async () => {
    const error = new Error('connection lost');
    const db = { transaction: vi.fn(async () => Promise.reject(error)) };
    await expect(new ResolutionService(db as unknown as Database).resolve('rr_abcdefghjkmn', input)).rejects.toBe(error);
  });
});
