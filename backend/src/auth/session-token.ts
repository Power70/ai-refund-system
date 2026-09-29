import type { CookieOptions } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'rs_session';
export const ADMIN_SESSION_COOKIE = 'rs_admin';
export const CUSTOMER_COOKIE_PATH = '/api';
export const ADMIN_COOKIE_PATH = '/api/v1/admin';
/** Idle timeout: a session ends after this long without use. */
export const SESSION_TTL_SECONDS = 30 * 60;
/** Absolute lifetime from sign-in, however active the session is. */
export const SESSION_MAX_SECONDS = 12 * 60 * 60;

export interface SessionPayload {
  /** Customer id. */
  sub: string;
  /** Issued at, seconds since epoch. */
  iat: number;
  /** Expires at, seconds since epoch. */
  exp: number;
}

const encode = (data: string | Buffer) => Buffer.from(data).toString('base64url');
const signature = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest();

/** Session token format: `<base64url JSON payload>.<base64url HMAC-SHA256>`. */
export function signSessionToken(payload: SessionPayload, secret: string): string {
  const body = encode(JSON.stringify(payload));
  return `${body}.${encode(signature(body, secret))}`;
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** A new session for `sub`, valid for the idle window. */
export function issueSession(sub: string, secret: string, now: Date): IssuedToken {
  const iat = seconds(now);
  const exp = iat + SESSION_TTL_SECONDS;
  return { token: signSessionToken({ sub, iat, exp }, secret), expiresAt: new Date(exp * 1000) };
}

/**
 * Sliding expiry: once less than half the idle window is left, a token with the window restarted,
 * never past the absolute lifetime. Null when renewal is not due (or no longer possible).
 */
export function renewSession(payload: SessionPayload, secret: string, now: Date): IssuedToken | null {
  const nowSeconds = seconds(now);
  if (payload.exp - nowSeconds > SESSION_TTL_SECONDS / 2) return null;
  const exp = Math.min(nowSeconds + SESSION_TTL_SECONDS, payload.iat + SESSION_MAX_SECONDS);
  if (exp <= payload.exp) return null;
  return { token: signSessionToken({ sub: payload.sub, iat: payload.iat, exp }, secret), expiresAt: new Date(exp * 1000) };
}

/** Returns the payload when the token is authentic and unexpired at `now`, otherwise null. Never throws. */
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

/**
 * Reads the subject without verifying the signature. Only for rate-limit bucketing:
 * a forged value lands in its own bucket and is rejected by the guard.
 */
export function unverifiedSessionSubject(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  try {
    const sub = (JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub.length <= 64 ? sub : null;
  } catch {
    return null;
  }
}

/**
 * HttpOnly (not readable by page scripts), SameSite=Strict (not sent cross-site), scoped to `path`.
 * Secure when the request arrived over HTTPS; the local demo runs on plain HTTP.
 */
export function sessionCookieOptions(secure: boolean, path = CUSTOMER_COOKIE_PATH, expiresAt?: Date): CookieOptions {
  const options: CookieOptions = { httpOnly: true, sameSite: 'strict', secure, path };
  return expiresAt ? { ...options, expires: expiresAt } : options;
}

/** Constant-time comparison of two secrets. Hashing first hides their lengths. */
export function constantTimeEquals(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  return timingSafeEqual(digest(a), digest(b));
}
