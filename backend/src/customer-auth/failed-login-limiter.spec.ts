import { HttpException } from '@nestjs/common';
import { FailedLoginLimiter } from './failed-login-limiter.js';

describe('FailedLoginLimiter', () => {
  const t0 = 1_000_000;

  it('locks after 5 failures within 15 minutes', () => {
    const limiter = new FailedLoginLimiter();
    for (let i = 0; i < 5; i++) {
      limiter.assertNotLocked('a@x.com', t0 + i);
      limiter.recordFailure('a@x.com', t0 + i);
    }
    expect(() => limiter.assertNotLocked('a@x.com', t0 + 10)).toThrow(HttpException);
  });

  it('only locks the email that failed', () => {
    const limiter = new FailedLoginLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure('a@x.com', t0);
    expect(() => limiter.assertNotLocked('b@x.com', t0)).not.toThrow();
  });

  it('unlocks once the failures are older than 15 minutes', () => {
    const limiter = new FailedLoginLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure('a@x.com', t0);
    expect(() => limiter.assertNotLocked('a@x.com', t0 + 15 * 60_000)).not.toThrow();
  });

  it('allows 4 failures', () => {
    const limiter = new FailedLoginLimiter();
    for (let i = 0; i < 4; i++) limiter.recordFailure('a@x.com', t0);
    expect(() => limiter.assertNotLocked('a@x.com', t0)).not.toThrow();
  });
});
