import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { SESSION_COOKIE, unverifiedSessionSubject } from '../auth/session-token.js';

export const LOGIN_RATE_LIMIT = 'rateLimit:login';
export const SUBMIT_RATE_LIMIT = 'rateLimit:submit';
export const CHAT_RATE_LIMIT = 'rateLimit:chat';

/** Sign-in route: stricter per-IP limit. */
export const LoginRateLimit = () => SetMetadata(LOGIN_RATE_LIMIT, true);
/** Refund submission: 5 per minute per customer. */
export const SubmitRateLimit = () => SetMetadata(SUBMIT_RATE_LIMIT, true);
/** Chat messages (each may cost an AI call): 20 per minute per customer. */
export const ChatRateLimit = () => SetMetadata(CHAT_RATE_LIMIT, true);

/** Rate-limit key for signed-in routes: the session subject, falling back to the client IP. */
export function customerTracker(req: Record<string, any>): string {
  const sub = unverifiedSessionSubject((req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE]);
  return sub ? `customer:${sub}` : `ip:${String(req.ip)}`;
}

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

const MINUTE = 60_000;

const marked = (key: string) => (context: ExecutionContext): boolean => Reflect.getMetadata(key, context.getHandler()) === true;

/**
 * api: all routes, per IP. login-ip: sign-ins per IP. submit and chat: per customer.
 * Failed sign-ins per email and wrong admin tokens per IP are limited in AuthService.
 * In-memory storage suits a single instance; multiple instances would need shared storage (e.g. Redis).
 */
export const throttlerOptions: ThrottlerModuleOptions = {
  errorMessage: 'Too many requests. Please wait a moment and try again.',
  throttlers: [
    { name: 'api', ttl: MINUTE, limit: 120 },
    { name: 'login-ip', ttl: MINUTE, limit: 10, skipIf: (ctx) => !marked(LOGIN_RATE_LIMIT)(ctx) },
    { name: 'submit', ttl: MINUTE, limit: 5, skipIf: (ctx) => !marked(SUBMIT_RATE_LIMIT)(ctx), getTracker: customerTracker },
    { name: 'chat', ttl: MINUTE, limit: 20, skipIf: (ctx) => !marked(CHAT_RATE_LIMIT)(ctx), getTracker: customerTracker },
  ],
};
