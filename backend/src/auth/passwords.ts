import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const KEY_LENGTH = 32;
/** OWASP's scrypt setting (N=2^15, r=8, p=3): about 32 MiB and tens of milliseconds per check. */
const COST = { N: 2 ** 15, r: 8, p: 3 } as const;
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, { ...options, maxmem: MAX_MEMORY }, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

/** Salted scrypt hash, stored as `scrypt$N$r$p$<salt>$<key>` (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** Constant-time check of a password against a stored hash; false for a malformed hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  const params = [n, r, p].map(Number);
  if (scheme !== 'scrypt' || !salt || !key || params.some((v) => !Number.isInteger(v) || v < 1)) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), { N: params[0], r: params[1], p: params[2] });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** True when a stored hash uses weaker settings than today's, so it should be replaced after a successful sign-in. */
export function needsRehash(stored: string): boolean {
  const [, n, r, p] = stored.split('$').map(Number);
  return n < COST.N || r < COST.r || p < COST.p;
}

let dummy: Promise<string> | undefined;
/** A hash of a random password, checked when an email is unknown so that answer takes as long as a wrong password. */
export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(16).toString('base64url'));
  return dummy;
}
