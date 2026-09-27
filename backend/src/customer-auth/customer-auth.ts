import { Logger, type Provider, HttpException, HttpStatus, Injectable, createParamDecorator, type ExecutionContext, type CanActivate, Inject, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, CookieOptions } from 'express';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { SlidingFailureWindow } from '../common/rate-limit.js';
import type { Env } from '../config/env.js';

export interface AuthenticatedRequest extends Request {
  customerId: string;
}

export interface SessionPayload {
  /** Customer id. */
  sub: string;
  /** Issued at, seconds since epoch. */
  iat: number;
  /** Expires at, seconds since epoch. */
  exp: number;
}

const encode = (data: string | Buffer) => Buffer.from(data).toString('base64url');

function signature(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

/** "<base64url payload>.<base64url HMAC-SHA256>" — small, dependency-free and easy to audit. */
export function signSessionToken(payload: SessionPayload, secret: string): string {
  const body = encode(JSON.stringify(payload));
  return `${body}.${encode(signature(body, secret))}`;
}

/** The payload if the token is authentic and unexpired at `now`; otherwise null. Never throws. */
export function verifySessionToken(token: string, secret: string, now: Date): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expected = signature(body, secret);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number' || typeof payload.iat !== 'number') return null;
    if (payload.exp * 1000 <= now.getTime()) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = 'rs_session';
export const SESSION_TTL_SECONDS = 30 * 60;

/**
 * HttpOnly: page scripts can't read it (limits damage from any injected script).
 * SameSite=Strict: never sent on cross-site requests (CSRF defence, with the custom-header check).
 * Secure: set whenever the request arrived over HTTPS (behind a TLS proxy); the local demo is plain HTTP.
 * Path=/api: only sent to the API. A cookie (not a bearer token) because EventSource can't send headers.
 */
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'strict', secure, path: '/api', maxAge: SESSION_TTL_SECONDS * 1000 };
}

export const SESSION_SECRET = Symbol('SESSION_SECRET');

export const sessionSecretProvider: Provider = {
  provide: SESSION_SECRET,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): string => {
    const configured = config.get('SESSION_SECRET', { infer: true });
    if (configured) return configured;
    new Logger('CustomerSession').warn('SESSION_SECRET not set: using a random secret. Customer sessions end when the API restarts.');
    return randomBytes(32).toString('base64url');
  },
};

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

/** The signed-in customer's id (set by CustomerAuthGuard). */
export const CurrentCustomerId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => context.switchToHttp().getRequest<AuthenticatedRequest>().customerId,
);

/** Admits only requests carrying a valid, unexpired session cookie; exposes the customer id. */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(@Inject(SESSION_SECRET) private readonly secret: string) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & Partial<AuthenticatedRequest>>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const session = token ? verifySessionToken(token, this.secret, new Date()) : null;
    if (!session) throw new UnauthorizedException('Please verify your email and order number to continue.');
    req.customerId = session.sub;
    return true;
  }
}
