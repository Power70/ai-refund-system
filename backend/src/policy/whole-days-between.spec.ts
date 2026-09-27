import { wholeDaysBetween } from './whole-days-between.js';

describe('wholeDaysBetween', () => {
  const t0 = new Date('2026-09-01T12:00:00Z');
  it.each([
    ['2026-09-01T12:00:00Z', 0],
    ['2026-09-02T11:59:59Z', 0],
    ['2026-09-02T12:00:00Z', 1],
    ['2026-10-01T11:59:59Z', 29],
    ['2026-10-01T12:00:00Z', 30],
    ['2026-10-02T11:59:59Z', 30],
    ['2026-10-02T12:00:00Z', 31],
  ])('to %s → %i', (to, days) => {
    expect(wholeDaysBetween(t0, new Date(to))).toBe(days);
  });
});
