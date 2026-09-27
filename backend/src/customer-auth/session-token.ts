import { createHmac, timingSafeEqual } from 'node:crypto';

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
