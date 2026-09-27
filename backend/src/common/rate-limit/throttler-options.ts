import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { customerTracker } from './customer-tracker.js';
import { CHAT_RATE_LIMIT, LOGIN_RATE_LIMIT, SUBMIT_RATE_LIMIT } from './rate-limit.decorators.js';

const MINUTE = 60_000;

const marked = (key: string) => (context: ExecutionContext): boolean => Reflect.getMetadata(key, context.getHandler()) === true;

/**
 * api: all routes, per IP. login-ip: sign-ins per IP. submit and chat: per customer.
 * Failed sign-ins per email are limited by FailedLoginLimiter.
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
