import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { customerTracker } from './customer-tracker.js';
import { LOGIN_RATE_LIMIT } from './login-rate-limit.decorator.js';
import { SUBMIT_RATE_LIMIT } from './submit-rate-limit.decorator.js';

const MINUTE = 60_000;

const marked = (key: string) => (context: ExecutionContext): boolean => Reflect.getMetadata(key, context.getHandler()) === true;
const isLoginRoute = marked(LOGIN_RATE_LIMIT);
const isSubmitRoute = marked(SUBMIT_RATE_LIMIT);

/**
 * - api:         every API route, per client IP (general abuse and cost protection).
 * - login-ip:    sign-in attempts per IP.
 * - submit:      refund submissions per customer (each one may cost an AI call later).
 * Failed sign-ins per email are limited separately by FailedLoginLimiter (only failures count).
 * In-memory storage: fine for a single API instance; several instances would share Redis.
 */
export const throttlerOptions: ThrottlerModuleOptions = {
  errorMessage: 'Too many requests. Please wait a moment and try again.',
  throttlers: [
    { name: 'api', ttl: MINUTE, limit: 120 },
    { name: 'login-ip', ttl: MINUTE, limit: 10, skipIf: (ctx) => !isLoginRoute(ctx) },
    { name: 'submit', ttl: MINUTE, limit: 5, skipIf: (ctx) => !isSubmitRoute(ctx), getTracker: customerTracker },
  ],
};
