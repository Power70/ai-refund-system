import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compares two secrets in constant time. Both are hashed first so the comparison takes the
 * same time whatever their lengths (a plain timingSafeEqual would reveal the length).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  return timingSafeEqual(digest(a), digest(b));
}
