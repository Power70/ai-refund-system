const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days elapsed from `from` to `to`, rounded down (UTC, no DST effects).
 * Day 30 of a 30-day window is day 30 until a full 31st day has passed.
 */
export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}
