import { randomInt } from 'node:crypto';

// Crockford base32, lower-case: no i, l, o, u, so IDs are easy to read out over the phone.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const LENGTH = 12;

/**
 * Customer-facing request ID, e.g. "rr_7k3p9qa2mx4d". 60 random bits from a CSPRNG:
 * not sequential, not guessable, and collisions are negligible (the column is unique anyway).
 */
export function generatePublicRequestId(): string {
  let id = 'rr_';
  for (let i = 0; i < LENGTH; i++) id += ALPHABET[randomInt(ALPHABET.length)];
  return id;
}
