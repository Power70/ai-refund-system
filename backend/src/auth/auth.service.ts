import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { firstNameOf } from '../common/format.js';
import type { SlidingFailureWindow } from '../common/rate-limit.js';
import { DATABASE, type Database } from '../database/database.providers.js';
import { customers } from '../database/schema.js';
import { ADMIN_FAILURES, ADMIN_PASSWORD, LOGIN_FAILURES, SESSION_SECRET } from './auth.providers.js';
import { DUMMY_PASSWORD_HASH, verifyPassword } from './passwords.js';
import { constantTimeEquals, issueSession, renewSession, verifySessionToken, type IssuedToken } from './session-token.js';

/** Same message for every sign-in failure, so responses never reveal which part was wrong. */
export const SIGN_IN_FAILED = 'Invalid credentials.';
export const TOO_MANY_ATTEMPTS = 'Too many requests. Please wait a moment and try again.';

export interface IssuedSession {
  token: string;
  firstName: string;
  expiresAt: Date;
}

export type AdminCheck = 'ok' | 'invalid' | 'locked';

export type SessionKind = 'customer' | 'admin';

/** A verified session: its subject, and a renewed token when the sliding window is due. */
export interface VerifiedSession {
  sub: string;
  renewed: IssuedToken | null;
}

const ADMIN_SUBJECT = 'admin';

/** Customer sessions (email + password), admin sessions and the admin password check. */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SESSION_SECRET) private readonly sessionSecret: string,
    @Inject(ADMIN_PASSWORD) private readonly adminPassword: string,
    @Inject(LOGIN_FAILURES) private readonly loginFailures: SlidingFailureWindow,
    @Inject(ADMIN_FAILURES) private readonly adminFailures: SlidingFailureWindow,
  ) {}

  /**
   * Email + password. Only failures count towards the per-email lock, and a locked email is
   * refused even with the right password, so a guesser can't confirm a hit.
   */
  async signIn(email: string, password: string, now = new Date()): Promise<IssuedSession> {
    if (this.loginFailures.isLocked(email, now.getTime())) throw new HttpException(TOO_MANY_ATTEMPTS, HttpStatus.TOO_MANY_REQUESTS);

    const customer = await this.findCustomerByEmail(email);
    // An unknown email still costs one hash check, so timing doesn't reveal which part was wrong.
    const valid = await verifyPassword(password, customer?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!customer || !customer.passwordHash || !valid) {
      this.loginFailures.recordFailure(email, now.getTime());
      throw new UnauthorizedException(SIGN_IN_FAILED);
    }

    return { ...issueSession(customer.id, this.secretFor('customer'), now), firstName: firstNameOf(customer.name) };
  }

  /** Customer id for a valid, unexpired session token, otherwise null. */
  verifySession(token: string | undefined, now = new Date()): string | null {
    return this.session('customer', token, now)?.sub ?? null;
  }

  /** Verifies a session cookie of either kind; admin sessions must name the admin subject. */
  session(kind: SessionKind, token: string | undefined, now = new Date()): VerifiedSession | null {
    if (!token) return null;
    const secret = this.secretFor(kind);
    const payload = verifySessionToken(token, secret, now);
    if (!payload || (kind === 'admin') !== (payload.sub === ADMIN_SUBJECT)) return null;
    return { sub: payload.sub, renewed: renewSession(payload, secret, now) };
  }

  /** Exchanges the admin password for a session cookie, under the same per-IP lock as the header. */
  startAdminSession(password: string, ip: string, now = new Date()): { result: AdminCheck; session: IssuedToken | null } {
    const result = this.checkAdmin(`Bearer ${password}`, ip);
    return { result, session: result === 'ok' ? issueSession(ADMIN_SUBJECT, this.secretFor('admin'), now) : null };
  }

  async describeCustomer(customerId: string): Promise<{ firstName: string } | null> {
    const [customer] = await this.db.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
    return customer ? { firstName: firstNameOf(customer.name) } : null;
  }

  /** Checks an `Authorization: Bearer <password>` header against ADMIN_PASSWORD; wrong ones lock the IP for a while. */
  checkAdmin(authorization: string | undefined, ip: string): AdminCheck {
    if (this.adminFailures.isLocked(ip)) return 'locked';
    const presented = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (presented && constantTimeEquals(presented, this.adminPassword)) return 'ok';
    this.adminFailures.recordFailure(ip);
    return 'invalid';
  }

  /** Separate keys per kind, so a customer cookie can never pass as an admin one. */
  private secretFor(kind: SessionKind): string {
    return kind === 'admin' ? `${this.sessionSecret}:admin` : this.sessionSecret;
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
