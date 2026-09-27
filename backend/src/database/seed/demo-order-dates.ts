const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SHIPPING_DAYS = 3;
const UNDELIVERED_PLACED_DAYS_AGO = 2;

/**
 * Turns "delivered N days ago" into concrete timestamps relative to `now`.
 * Delivery is placed one hour past the N-day mark, so the order keeps reading as
 * exactly N whole days old for the next 23 hours (the demo stays stable during a review).
 */
export function demoOrderDates(deliveredDaysAgo: number | null, now: Date): { placedAt: Date; deliveredAt: Date | null } {
  if (deliveredDaysAgo === null) {
    return { placedAt: new Date(now.getTime() - UNDELIVERED_PLACED_DAYS_AGO * DAY_MS), deliveredAt: null };
  }
  const deliveredAt = new Date(now.getTime() - deliveredDaysAgo * DAY_MS - HOUR_MS);
  return { placedAt: new Date(deliveredAt.getTime() - SHIPPING_DAYS * DAY_MS), deliveredAt };
}
