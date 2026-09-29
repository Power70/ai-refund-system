import { HttpException, UnauthorizedException } from '@nestjs/common';
import { SlidingFailureWindow } from '../common/rate-limit.js';
import type { Database } from '../database/database.providers.js';
import { AuthService } from './auth.service.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './passwords.js';
import { verifySessionToken } from './session-token.js';

const SECRET = 's'.repeat(32);
const ADMIN = 'admin-token-123';
const now = new Date('2026-09-27T12:00:00Z');

let customerHash: string;
beforeAll(async () => {
  customerHash = await hashPassword('customer');
});

type Found = { id: string; name: string; passwordHash: string | null } | null;

function setup(found: Found | 'default' = 'default') {
  const service = new AuthService({} as Database, SECRET, ADMIN, new SlidingFailureWindow(5, 15 * 60_000), new SlidingFailureWindow(10, 15 * 60_000));
  const customer = found === 'default' ? { id: 'customer-1', name: 'Ada Okafor', passwordHash: customerHash } : found;
  const lookup = vi.spyOn(service as unknown as { findCustomerByEmail: () => Promise<unknown> }, 'findCustomerByEmail').mockResolvedValue(customer ?? undefined);
  return { service, lookup };
}

describe('passwords', () => {
  it('hashes with a random salt and verifies only the right password', async () => {
    const again = await hashPassword('customer');
    expect(again).not.toBe(customerHash);
    expect(customerHash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword('customer', customerHash)).toBe(true);
    expect(await verifyPassword('Customer', customerHash)).toBe(false);
    expect(await verifyPassword('customer', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('customer', DUMMY_PASSWORD_HASH)).toBe(false);
  });
});

describe('AuthService', () => {
  describe('signIn', () => {
    it('issues a 30-minute session token for the right email and password', async () => {
      const { service } = setup();
      const session = await service.signIn('ada@example.com', 'customer', now);
      expect(session).toMatchObject({ firstName: 'Ada', expiresAt: new Date(now.getTime() + 30 * 60_000) });
      expect(verifySessionToken(session.token, SECRET, now)?.sub).toBe('customer-1');
    });

    it('answers a wrong password, an unknown email or an account without a password with the same "Invalid credentials."', async () => {
      await expect(setup().service.signIn('ada@example.com', 'wrong', now)).rejects.toThrow(new UnauthorizedException('Invalid credentials.'));
      await expect(setup(null).service.signIn('nobody@example.com', 'customer', now)).rejects.toThrow(new UnauthorizedException('Invalid credentials.'));
      await expect(setup({ id: 'c', name: 'No Password', passwordHash: null }).service.signIn('np@example.com', 'customer', now)).rejects.toThrow(UnauthorizedException);
    });

    it('locks an email after 5 failures, even for the right password; other emails are unaffected', async () => {
      const { service } = setup();
      for (let i = 0; i < 5; i++) await service.signIn('ada@example.com', 'wrong', now).catch(() => undefined);
      await expect(service.signIn('ada@example.com', 'customer', now)).rejects.toThrow(HttpException);
      await expect(service.signIn('ben@example.com', 'customer', now)).resolves.toMatchObject({ firstName: 'Ada' });
    });

    it('never counts successful sign-ins', async () => {
      const { service } = setup();
      for (let i = 0; i < 6; i++) await service.signIn('ada@example.com', 'customer', now);
      await expect(service.signIn('ada@example.com', 'customer', now)).resolves.toBeDefined();
    });
  });

  describe('verifySession', () => {
    it('returns the customer id for a valid token and null otherwise', async () => {
      const { service } = setup();
      const { token } = await service.signIn('ada@example.com', 'customer', now);
      expect(service.verifySession(token, now)).toBe('customer-1');
      expect(service.verifySession(undefined, now)).toBeNull();
      expect(service.verifySession(`${token}x`, now)).toBeNull();
      expect(service.verifySession(token, new Date(now.getTime() + 31 * 60_000))).toBeNull();
    });
  });

  describe('checkAdmin', () => {
    it('accepts only the exact bearer token', () => {
      const { service } = setup();
      expect(service.checkAdmin(`Bearer ${ADMIN}`, '10.0.0.1')).toBe('ok');
      expect(service.checkAdmin(ADMIN, '10.0.0.1')).toBe('invalid');
      expect(service.checkAdmin(`Bearer ${ADMIN}x`, '10.0.0.1')).toBe('invalid');
      expect(service.checkAdmin(undefined, '10.0.0.1')).toBe('invalid');
    });

    it('locks an IP after 10 wrong tokens, without affecting other IPs', () => {
      const { service } = setup();
      for (let i = 0; i < 10; i++) service.checkAdmin('Bearer wrong', '10.0.0.2');
      expect(service.checkAdmin(`Bearer ${ADMIN}`, '10.0.0.2')).toBe('locked');
      expect(service.checkAdmin(`Bearer ${ADMIN}`, '10.0.0.3')).toBe('ok');
    });
  });

  describe('admin sessions', () => {
    it('exchanges the admin token for a session that only passes as an admin one', () => {
      const { service } = setup();
      const { result, session } = service.startAdminSession(ADMIN, '10.0.0.4', now);
      expect(result).toBe('ok');
      expect(service.session('admin', session!.token, now)).toEqual({ sub: 'admin', renewed: null });
      expect(service.session('customer', session!.token, now)).toBeNull();
    });

    it('never accepts a customer session as an admin one', async () => {
      const { service } = setup();
      const { token } = await service.signIn('ada@example.com', 'customer', now);
      expect(service.session('customer', token, now)?.sub).toBe('customer-1');
      expect(service.session('admin', token, now)).toBeNull();
    });

    it('refuses a wrong token and counts it towards the IP lock', () => {
      const { service } = setup();
      expect(service.startAdminSession('wrong-token-123', '10.0.0.5', now)).toEqual({ result: 'invalid', session: null });
      for (let i = 0; i < 9; i++) service.startAdminSession('wrong-token-123', '10.0.0.5', now);
      expect(service.startAdminSession(ADMIN, '10.0.0.5', now)).toEqual({ result: 'locked', session: null });
    });
  });
});
