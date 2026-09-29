import { HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { firstNameOf } from '../common/format.js';
import type { SlidingFailureWindow } from '../common/rate-limit.js';
import { DATABASE, type Database } from '../database/database.providers.js';
import { customers } from '../database/schema.js';
import { ADMIN_FAILURES, ADMIN_PASSWORD_HASH, LOGIN_FAILURES } from './auth.providers.js';
import { dummyPasswordHash, hashPassword, needsRehash, verifyPassword } from './passwords.js';
import { SessionsService, type IssuedSession, type SessionKind, type VerifiedSession } from './sessions.service.js';

/** Same message for every sign-in failure, so responses never reveal which part was wrong. */
export const SIGN_IN_FAILED = 'Invalid credentials.';
export const TOO_MANY_ATTEMPTS = 'Too many requests. Please wait a moment and try again.';

export type AdminCheck = 'ok' | 'invalid' | 'locked';

export type CustomerSession = IssuedSession & { firstName: string };

/** Customer and admin sign-in, sessions and sign-out. */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ADMIN_PASSWORD_HASH) private readonly adminPasswordHash: string,
    @Inject(LOGIN_FAILURES) private readonly loginFailures: SlidingFailureWindow,
    @Inject(ADMIN_FAILURES) private readonly adminFailures: SlidingFailureWindow,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * Email + password. Only failures count towards the per-email lock, and a locked email is
   * refused even with the right password, so a guesser can't confirm a hit.
   */
  async signIn(email: string, password: string, now = new Date()): Promise<CustomerSession> {
    if (this.loginFailures.isLocked(email, now.getTime())) throw new HttpException(TOO_MANY_ATTEMPTS, HttpStatus.TOO_MANY_REQUESTS);

    const customer = await this.findCustomerByEmail(email);
    // An unknown email still costs one hash check, so timing doesn't reveal which part was wrong.
    const valid = await verifyPassword(password, customer?.passwordHash ?? (await dummyPasswordHash()));
    if (!customer?.passwordHash || !valid) {
      this.loginFailures.recordFailure(email, now.getTime());
      if (this.loginFailures.isLocked(email, now.getTime())) this.logger.warn('Customer sign-in locked for 15 minutes after repeated failures');
      throw new UnauthorizedException(SIGN_IN_FAILED);
    }

    if (needsRehash(customer.passwordHash)) {
      await this.db.update(customers).set({ passwordHash: await hashPassword(password) }).where(eq(customers.id, customer.id));
    }
    return { ...(await this.sessions.create('CUSTOMER', customer.id, now)), firstName: firstNameOf(customer.name) };
  }

  /** The live session of `kind` behind this cookie value, or null. */
  session(kind: SessionKind, token: unknown, now = new Date()): Promise<VerifiedSession | null> {
    return this.sessions.verify(kind, token, now);
  }

  /** Ends the session behind this cookie value on the server, not just in the browser. */
  signOut(token: unknown): Promise<void> {
    return this.sessions.revoke(token);
  }

  async describeCustomer(customerId: string): Promise<{ firstName: string } | null> {
    const [customer] = await this.db.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
    return customer ? { firstName: firstNameOf(customer.name) } : null;
  }

  /** Checks `Authorization: Bearer <password>` (API clients); wrong ones lock the IP for a while. */
  async checkAdmin(authorization: string | undefined, ip: string): Promise<AdminCheck> {
    const presented = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    return this.checkAdminPassword(presented, ip);
  }

  /** Exchanges the admin password for a session, under the same per-IP lock as the header. */
  async startAdminSession(password: string, ip: string, now = new Date()): Promise<{ result: AdminCheck; session: IssuedSession | null }> {
    const result = await this.checkAdminPassword(password, ip);
    if (result === 'ok') this.logger.log(`Admin signed in from ${ip}`);
    return { result, session: result === 'ok' ? await this.sessions.create('ADMIN', null, now) : null };
  }

  private async checkAdminPassword(password: string, ip: string): Promise<AdminCheck> {
    if (this.adminFailures.isLocked(ip)) return 'locked';
    if (password && (await verifyPassword(password, this.adminPasswordHash))) return 'ok';
    this.adminFailures.recordFailure(ip);
    this.logger.warn(`Wrong admin password from ${ip}${this.adminFailures.isLocked(ip) ? '; locked for 15 minutes' : ''}`);
    return 'invalid';
  }

  protected async findCustomerByEmail(email: string): Promise<{ id: string; name: string; passwordHash: string | null } | undefined> {
    const [customer] = await this.db
      .select({ id: customers.id, name: customers.name, passwordHash: customers.passwordHash })
      .from(customers)
      .where(eq(customers.email, email))
      .limit(1);
    return customer;
  }
}
