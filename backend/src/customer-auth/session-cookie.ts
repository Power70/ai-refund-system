import type { CookieOptions } from 'express';

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
