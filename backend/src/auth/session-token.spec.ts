import { hashSessionToken, isSessionToken, newSessionToken, sessionCookieOptions } from './session-token.js';

describe('session tokens', () => {
  it('are 256 random bits, different every time', () => {
    const tokens = new Set(Array.from({ length: 100 }, newSessionToken));
    expect(tokens.size).toBe(100);
    for (const token of tokens) expect(isSessionToken(token)).toBe(true);
  });

  it('are stored only as a SHA-256 hash', () => {
    const token = newSessionToken();
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).not.toContain(token);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it.each([undefined, 42, '', 'abc', 'x'.repeat(43) + '=', 'a.b.c', `${'a'.repeat(42)}!`])('rejects %j before any lookup', (value) => {
    expect(isSessionToken(value)).toBe(false);
  });
});

describe('sessionCookieOptions', () => {
  it('is HttpOnly, SameSite=Strict and scoped, Secure over HTTPS', () => {
    const expires = new Date('2026-09-29T12:30:00Z');
    expect(sessionCookieOptions(true, '/api/v1/admin', expires)).toEqual({ httpOnly: true, sameSite: 'strict', secure: true, path: '/api/v1/admin', expires });
    expect(sessionCookieOptions(false)).toEqual({ httpOnly: true, sameSite: 'strict', secure: false, path: '/api' });
  });
});
