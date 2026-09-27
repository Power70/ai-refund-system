import { Injectable } from '@nestjs/common';
import { SlidingFailureWindow } from '../common/rate-limit/sliding-failure-window.js';

/** Locks an IP after 10 wrong admin tokens in 15 minutes (stops token guessing). */
@Injectable()
export class AdminAuthLimiter {
  private readonly window = new SlidingFailureWindow(10, 15 * 60_000);

  isLocked(ip: string): boolean {
    return this.window.isLocked(ip);
  }

  recordFailure(ip: string): void {
    this.window.recordFailure(ip);
  }
}
