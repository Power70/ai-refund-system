import { HttpException, UnauthorizedException } from '@nestjs/common';
import { randomBytes, scryptSync } from 'node:crypto';
import { SlidingFailureWindow } from '../common/rate-limit.js';
import type { Database } from '../database/database.providers.js';
import { AuthService } from './auth.service.js';
import { dummyPasswordHash, hashPassword, needsRehash, verifyPassword } from './passwords.js';
import type { IssuedSession, SessionKind, SessionsService } from './sessions.service.js';

const PASSWORD = 'correct horse battery';
const ADMIN_PASSWORD = 'admin pass phrase 42';
const now = new Date('2026-09-27T12:00:00Z');

let customerHash: string;
let adminHash: string;
beforeAll(async () => {
  [customerHash, adminHash] = await Promise.all([hashPassword(PASSWORD), hashPassword(ADMIN_PASSWORD)]);
});

/** In-memory stand-in for the sessions table. */
function fakeSessions() {
  const live = new Map<string, { kind: SessionKind; customerId: string | null }>();
  let n = 0;
  return {
    live,
    create: vi.fn(async (kind: SessionKind, customerId: string | null, at: Date): Promise<IssuedSession> => {
      const token = `token-${++n}`;
      live.set(token, { kind, customerId });
      return { token, expiresAt: new Date(at.getTime() + 30 * 60_000) };
    }),
    verify: vi.fn(async (kind: SessionKind, token: unknown) => {
      const session = live.get(String(token));
      return session?.kind === kind ? { customerId: session.customerId, renewedUntil: null } : null;
    }),
    revoke: vi.fn(async (token: unknown) => void live.delete(String(token))),
  };
}

type Found = { id: string; name: string; passwordHash: string | null } | null;

function setup(found: Found | 'default' = 'default') {
  const sessions = fakeSessions();
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const db = { update: vi.fn().mockReturnValue({ set }) };
  const service = new AuthService(
    db as unknown as Database,
    adminHash,
    new SlidingFailureWindow(5, 15 * 60_000),
    new SlidingFailureWindow(10, 15 * 60_000),
    sessions as unknown as SessionsService,
  );
  const customer = found === 'default' ? { id: 'customer-1', name: 'Ada Okafor', passwordHash: customerHash } : found;
  const lookup = vi.spyOn(service as unknown as { findCustomerByEmail: () => Promise<unknown> }, 'findCustomerByEmail').mockResolvedValue(customer ?? undefined);
  return { service, lookup, sessions, db, set };
}

describe('passwords', () => {
  it('hashes with scrypt at OWASP cost and a random salt, and verifies only the right password', async () => {
    const again = await hashPassword(PASSWORD);
    expect(again).not.toBe(customerHash);
    expect(customerHash).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(customerHash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, customerHash)).toBe(true);
    expect(await verifyPassword(PASSWORD.toUpperCase(), customerHash)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'not-a-hash')).toBe(false);
    expect(await verifyPassword(PASSWORD, await dummyPasswordHash())).toBe(false);
  });

  it('flags hashes made with weaker settings for replacement', () => {
    expect(needsRehash(customerHash)).toBe(false);
    expect(needsRehash('scrypt$16384$8$1$salt$key')).toBe(true);
  });
});

describe('AuthService', () => {
  describe('signIn', () => {
    it('starts a server-side customer session for the right email and password', async () => {
      const { service, sessions } = setup();
      const session = await service.signIn('ada@example.com', PASSWORD, now);
      expect(session).toMatchObject({ firstName: 'Ada', expiresAt: new Date(now.getTime() + 30 * 60_000) });
      expect(sessions.create).toHaveBeenCalledWith('CUSTOMER', 'customer-1', now);
      expect((await service.session('CUSTOMER', session.token, now))?.customerId).toBe('customer-1');
    });

    it('answers a wrong password, an unknown email or an account without a password with the same "Invalid credentials."', async () => {
      await expect(setup().service.signIn('ada@example.com', 'wrong', now)).rejects.toThrow(new UnauthorizedException('Invalid credentials.'));
      await expect(setup(null).service.signIn('nobody@example.com', PASSWORD, now)).rejects.toThrow(new UnauthorizedException('Invalid credentials.'));
      await expect(setup({ id: 'c', name: 'No Password', passwordHash: null }).service.signIn('np@example.com', PASSWORD, now)).rejects.toThrow(new UnauthorizedException('Invalid credentials.'));
    });

    it('locks an email after 5 failures, even for the right password; other emails are unaffected', async () => {
      const { service } = setup();
      for (let i = 0; i < 5; i++) await service.signIn('ada@example.com', 'wrong', now).catch(() => undefined);
      await expect(service.signIn('ada@example.com', PASSWORD, now)).rejects.toThrow(HttpException);
      await expect(service.signIn('ben@example.com', PASSWORD, now)).resolves.toMatchObject({ firstName: 'Ada' });
    });

    it('never counts successful sign-ins', async () => {
      const { service } = setup();
      for (let i = 0; i < 6; i++) await service.signIn('ada@example.com', PASSWORD, now);
      await expect(service.signIn('ada@example.com', PASSWORD, now)).resolves.toBeDefined();
    });

    it('replaces a hash made with weaker settings after a successful sign-in', async () => {
      const salt = randomBytes(16);
      const weak = ['scrypt', 16384, 8, 1, salt.toString('base64url'), scryptSync(PASSWORD, salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64url')].join('$');
      const { service, set } = setup({ id: 'customer-1', name: 'Ada Okafor', passwordHash: weak });
      await service.signIn('ada@example.com', PASSWORD, now);
      expect(set).toHaveBeenCalledWith({ passwordHash: expect.stringMatching(/^scrypt\$32768\$8\$3\$/) });
    });
  });

  describe('signOut', () => {
    it('ends the session on the server, so the same cookie no longer works', async () => {
      const { service } = setup();
      const { token } = await service.signIn('ada@example.com', PASSWORD, now);
      await service.signOut(token);
      expect(await service.session('CUSTOMER', token, now)).toBeNull();
    });
  });

  describe('checkAdmin', () => {
    it('accepts only the exact admin password as a bearer credential', async () => {
      const { service } = setup();
      expect(await service.checkAdmin(`Bearer ${ADMIN_PASSWORD}`, '10.0.0.1')).toBe('ok');
      expect(await service.checkAdmin(ADMIN_PASSWORD, '10.0.0.1')).toBe('invalid');
      expect(await service.checkAdmin(`Bearer ${ADMIN_PASSWORD}x`, '10.0.0.1')).toBe('invalid');
      expect(await service.checkAdmin(undefined, '10.0.0.1')).toBe('invalid');
    });

    it('locks an IP after 10 wrong passwords, without affecting other IPs', async () => {
      const { service } = setup();
      for (let i = 0; i < 10; i++) await service.checkAdmin('Bearer wrong', '10.0.0.2');
      expect(await service.checkAdmin(`Bearer ${ADMIN_PASSWORD}`, '10.0.0.2')).toBe('locked');
      expect(await service.checkAdmin(`Bearer ${ADMIN_PASSWORD}`, '10.0.0.3')).toBe('ok');
    });
  });

  describe('admin sessions', () => {
    it('exchanges the admin password for a session that only passes as an admin one', async () => {
      const { service } = setup();
      const { result, session } = await service.startAdminSession(ADMIN_PASSWORD, '10.0.0.4', now);
      expect(result).toBe('ok');
      expect(await service.session('ADMIN', session!.token, now)).toEqual({ customerId: null, renewedUntil: null });
      expect(await service.session('CUSTOMER', session!.token, now)).toBeNull();
    });

    it('never accepts a customer session as an admin one', async () => {
      const { service } = setup();
      const { token } = await service.signIn('ada@example.com', PASSWORD, now);
      expect((await service.session('CUSTOMER', token, now))?.customerId).toBe('customer-1');
      expect(await service.session('ADMIN', token, now)).toBeNull();
    });

    it('refuses a wrong password and counts it towards the IP lock', async () => {
      const { service, sessions } = setup();
      expect(await service.startAdminSession('wrong-password-1', '10.0.0.5', now)).toEqual({ result: 'invalid', session: null });
      for (let i = 0; i < 9; i++) await service.startAdminSession('wrong-password-1', '10.0.0.5', now);
      expect(await service.startAdminSession(ADMIN_PASSWORD, '10.0.0.5', now)).toEqual({ result: 'locked', session: null });
      expect(sessions.create).not.toHaveBeenCalled();
    });
  });
});
