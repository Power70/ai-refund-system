import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { LOGIN_RATE_LIMIT } from './login-rate-limit.decorator.js';

const MINUTE = 60_000;

function isLoginRoute(context: ExecutionContext): boolean {
  return Reflect.getMetadata(LOGIN_RATE_LIMIT, context.getHandler()) === true;
}

/**
 * - api:         every API route, per client IP (general abuse and cost protection).
 * - login-ip:    sign-in attempts per IP.
 * Failed sign-ins per email are limited separately by FailedLoginLimiter (only failures count).
 * In-memory storage: fine for a single API instance; several instances would share Redis.
 */
export const throttlerOptions: ThrottlerModuleOptions = {
  errorMessage: 'Too many requests. Please wait a moment and try again.',
  throttlers: [
    { name: 'api', ttl: MINUTE, limit: 120 },
    { name: 'login-ip', ttl: MINUTE, limit: 10, skipIf: (ctx) => !isLoginRoute(ctx) },
  ],
};
