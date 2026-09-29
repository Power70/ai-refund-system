import type { CookieOptions } from 'express';
import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'rs_session';
export const ADMIN_SESSION_COOKIE = 'rs_admin';
export const CUSTOMER_COOKIE_PATH = '/api';
export const ADMIN_COOKIE_PATH = '/api/v1/admin';
/** Idle timeout: a session ends after this long without use. */
export const SESSION_TTL_SECONDS = 30 * 60;
/** Absolute lifetime from sign-in, however active the session is. */
export const SESSION_MAX_SECONDS = 12 * 60 * 60;

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new session token: 256 random bits, base64url. Only the client ever holds it. */
export function newSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** What the database stores instead of the token, so a copy of the database can't be used to sign in. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** True for a string shaped like one of our tokens; anything else is rejected without a database lookup. */
export function isSessionToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/**
 * HttpOnly (not readable by page scripts), SameSite=Strict (not sent cross-site), scoped to `path`.
 * Secure when the request arrived over HTTPS; the local demo runs on plain HTTP.
 */
export function sessionCookieOptions(secure: boolean, path = CUSTOMER_COOKIE_PATH, expiresAt?: Date): CookieOptions {
  const options: CookieOptions = { httpOnly: true, sameSite: 'strict', secure, path };
  return expiresAt ? { ...options, expires: expiresAt } : options;
}

