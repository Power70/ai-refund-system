import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { SlidingFailureWindow } from '../common/rate-limit/sliding-failure-window.js';

/**
 * Locks an email after 5 failed sign-ins in 15 minutes, whichever IPs they came from.
 * Only failures count, so a customer signing in from several tabs is never locked out.
 * While locked, even a correct attempt is refused, so a guesser can't confirm a hit.
 */
@Injectable()
export class FailedLoginLimiter {
  private readonly window = new SlidingFailureWindow(5, 15 * 60_000);

  assertNotLocked(email: string, now = Date.now()): void {
    if (this.window.isLocked(email, now)) {
      throw new HttpException('Too many requests. Please wait a moment and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  recordFailure(email: string, now = Date.now()): void {
    this.window.recordFailure(email, now);
  }
}
