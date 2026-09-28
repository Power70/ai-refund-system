import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { firstNameOf } from '../common/format.js';
import type { SlidingFailureWindow } from '../common/rate-limit.js';
import { DATABASE, type Database } from '../database/database.providers.js';
import { customers, orders } from '../database/schema.js';
import { ADMIN_FAILURES, ADMIN_TOKEN, LOGIN_FAILURES, SESSION_SECRET } from './auth.providers.js';
import { constantTimeEquals, SESSION_TTL_SECONDS, signSessionToken, verifySessionToken } from './session-token.js';

/** Same message for every sign-in failure, so responses never reveal which part was wrong. */
export const SIGN_IN_FAILED = "We couldn't find an order with those details.";
export const TOO_MANY_ATTEMPTS = 'Too many requests. Please wait a moment and try again.';

export interface IssuedSession {
  token: string;
  firstName: string;
  expiresAt: Date;
}

export type AdminCheck = 'ok' | 'invalid' | 'locked';


/** Customer sessions (email + order number) and admin token checks. */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SESSION_SECRET) private readonly sessionSecret: string,
    @Inject(ADMIN_TOKEN) private readonly adminToken: string,
    @Inject(LOGIN_FAILURES) private readonly loginFailures: SlidingFailureWindow,
    @Inject(ADMIN_FAILURES) private readonly adminFailures: SlidingFailureWindow,
  ) {}

  /**
   * Proves ownership with email + order number. Only failures count towards the per-email lock,
   * and a locked email is refused even with correct details, so a guesser can't confirm a hit.
   */
  async signIn(email: string, orderNumber: string, now = new Date()): Promise<IssuedSession> {
    if (this.loginFailures.isLocked(email, now.getTime())) throw new HttpException(TOO_MANY_ATTEMPTS, HttpStatus.TOO_MANY_REQUESTS);

    const match = await this.findCustomerByOrder(email, orderNumber);
    if (!match) {
      this.loginFailures.recordFailure(email, now.getTime());
      throw new NotFoundException(SIGN_IN_FAILED);
    }

    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + SESSION_TTL_SECONDS;
    return { token: signSessionToken({ sub: match.id, iat, exp }, this.sessionSecret), firstName: firstNameOf(match.name), expiresAt: new Date(exp * 1000) };
  }

  /** Customer id for a valid, unexpired session token, otherwise null. */
  verifySession(token: string | undefined, now = new Date()): string | null {
    return token ? (verifySessionToken(token, this.sessionSecret, now)?.sub ?? null) : null;
  }

  async describeCustomer(customerId: string): Promise<{ firstName: string } | null> {
    const [customer] = await this.db.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
    return customer ? { firstName: firstNameOf(customer.name) } : null;
  }

  /** Checks an `Authorization` header against ADMIN_TOKEN; wrong tokens lock the IP for a while. */
  checkAdmin(authorization: string | undefined, ip: string): AdminCheck {
    if (this.adminFailures.isLocked(ip)) return 'locked';
    const presented = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (presented && constantTimeEquals(presented, this.adminToken)) return 'ok';
    this.adminFailures.recordFailure(ip);
    return 'invalid';
  }

  /** One query whichever part is wrong, so timing doesn't reveal which. */
  protected async findCustomerByOrder(email: string, orderNumber: string): Promise<{ id: string; name: string } | undefined> {
    const [match] = await this.db
      .select({ id: customers.id, name: customers.name })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(customers.email, email), eq(orders.orderNumber, orderNumber)))
      .limit(1);
    return match;
  }
}
