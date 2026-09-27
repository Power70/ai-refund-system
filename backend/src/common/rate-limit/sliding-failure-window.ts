/**
 * Counts failures per key within a sliding time window. Used to lock a key (an email, an IP)
 * after too many failed attempts. In-memory: fine for one API instance; several instances
 * would share this via Redis.
 */
export class SlidingFailureWindow {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
  ) {}

  isLocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.maxFailures;
  }

  recordFailure(key: string, now = Date.now()): void {
    this.failures.set(key, [...this.recent(key, now), now]);
  }

  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (kept.length === 0) this.failures.delete(key);
    else this.failures.set(key, kept);
    return kept;
  }
}
