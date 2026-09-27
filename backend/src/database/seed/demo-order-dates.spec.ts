import { wholeDaysBetween } from '../../policy/whole-days-between.js';
import { demoOrderDates } from './demo-order-dates.js';

const now = new Date('2026-09-27T09:00:00Z');

describe('demoOrderDates', () => {
  it('reads as exactly N whole days old now and for the next 23 hours', () => {
    const { deliveredAt } = demoOrderDates(30, now);
    expect(wholeDaysBetween(deliveredAt!, now)).toBe(30);
    expect(wholeDaysBetween(deliveredAt!, new Date(now.getTime() + 22 * 3_600_000))).toBe(30);
  });

  it('places the order before delivery', () => {
    const { placedAt, deliveredAt } = demoOrderDates(5, now);
    expect(placedAt.getTime()).toBeLessThan(deliveredAt!.getTime());
  });

  it('leaves undelivered orders without a delivery date, placed in the past', () => {
    const { placedAt, deliveredAt } = demoOrderDates(null, now);
    expect(deliveredAt).toBeNull();
    expect(placedAt.getTime()).toBeLessThan(now.getTime());
  });
});
