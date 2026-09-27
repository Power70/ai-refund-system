import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

/**
 * Locks an email after 5 failed sign-ins in 15 minutes, whichever IPs they came from.
 * Only failures count, so a customer signing in from several tabs is never locked out.
 * While locked, even a correct attempt is refused, so a guesser can't confirm a hit.
 * In-memory: fine for one API instance; several instances would share this via Redis.
 */
@Injectable()
export class FailedLoginLimiter {
  private readonly failures = new Map<string, number[]>();

  assertNotLocked(email: string, now = Date.now()): void {
    if (this.recent(email, now).length >= MAX_FAILURES) {
      throw new HttpException('Too many requests. Please wait a moment and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  recordFailure(email: string, now = Date.now()): void {
    this.failures.set(email, [...this.recent(email, now), now]);
  }

  private recent(email: string, now: number): number[] {
    const kept = (this.failures.get(email) ?? []).filter((t) => now - t < WINDOW_MS);
    if (kept.length === 0) this.failures.delete(email);
    else this.failures.set(email, kept);
    return kept;
  }
}
