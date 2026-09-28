import { createHmac } from 'node:crypto';
import { constantTimeEquals, signSessionToken, unverifiedSessionSubject, verifySessionToken } from './session-token.js';

const secret = 's'.repeat(32);
const now = new Date('2026-09-27T12:00:00Z');
const nowSec = Math.floor(now.getTime() / 1000);
const payload = { sub: 'customer-1', iat: nowSec, exp: nowSec + 1800 };

describe('session token', () => {
  it('round-trips a valid token', () => {
    expect(verifySessionToken(signSessionToken(payload, secret), secret, now)).toEqual(payload);
  });

  it('rejects an expired token', () => {
    const token = signSessionToken(payload, secret);
    expect(verifySessionToken(token, secret, new Date((payload.exp + 1) * 1000))).toBeNull();
    expect(verifySessionToken(token, secret, new Date(payload.exp * 1000))).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    expect(verifySessionToken(signSessionToken(payload, 'x'.repeat(32)), secret, now)).toBeNull();
  });

  it('rejects a payload swapped to another customer', () => {
    const [, sig] = signSessionToken(payload, secret).split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...payload, sub: 'customer-2' })).toString('base64url')}.${sig}`;
    expect(verifySessionToken(forged, secret, now)).toBeNull();
  });

  it('rejects an extended expiry', () => {
    const [, sig] = signSessionToken(payload, secret).split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...payload, exp: payload.exp + 999_999 })).toString('base64url')}.${sig}`;
    expect(verifySessionToken(forged, secret, now)).toBeNull();
  });

  it.each(['', 'abc', 'a.b.c', '.', 'eyJ9.', `${Buffer.from('not json').toString('base64url')}.x`])('rejects malformed input %j without throwing', (token) => {
    expect(verifySessionToken(token, secret, now)).toBeNull();
  });

  it('rejects a well-signed token with a malformed payload', () => {
    const body = Buffer.from(JSON.stringify({ sub: 42 })).toString('base64url');
    const sig = createHmac('sha256', secret).update(body).digest('base64url');
    expect(verifySessionToken(`${body}.${sig}`, secret, now)).toBeNull();
  });
});

describe('unverifiedSessionSubject', () => {
  it('reads the subject for rate-limit bucketing', () => {
    expect(unverifiedSessionSubject(signSessionToken(payload, secret))).toBe('customer-1');
  });

  it.each([undefined, 42, 'garbage', `${Buffer.from(JSON.stringify({ sub: 'x'.repeat(65) })).toString('base64url')}.sig`])('returns null for %j', (token) => {
    expect(unverifiedSessionSubject(token)).toBeNull();
  });
});

describe('constantTimeEquals', () => {
  it('matches only identical strings', () => {
    expect(constantTimeEquals('admin-demo-token', 'admin-demo-token')).toBe(true);
    expect(constantTimeEquals('admin-demo-token', 'admin-demo-tokeN')).toBe(false);
    expect(constantTimeEquals('admin-demo-token', 'admin-demo-token ')).toBe(false);
    expect(constantTimeEquals('', 'x')).toBe(false);
  });
});
