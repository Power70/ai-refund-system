import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DATABASE } from '../database/database.tokens.js';
import type { Database } from '../database/database.types.js';
import { FailedLoginLimiter } from './failed-login-limiter.js';
import { customers, orders } from '../database/schema/index.js';
import { SESSION_TTL_SECONDS } from './session-cookie.js';
import { SESSION_SECRET } from './session-secret.provider.js';
import { signSessionToken } from './session-token.js';

/** One message for every failure, so responses never reveal whether an email or an order exists. */
export const SESSION_NOT_FOUND = "We couldn't find an order with those details.";

export interface IssuedSession {
  token: string;
  firstName: string;
  expiresAt: Date;
}

@Injectable()
export class CustomerSessionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SESSION_SECRET) private readonly secret: string,
    private readonly failedLogins: FailedLoginLimiter,
  ) {}

  /** Proves ownership with email + order number in one query (same work whichever part is wrong). */
  async start(email: string, orderNumber: string, now = new Date()): Promise<IssuedSession> {
    this.failedLogins.assertNotLocked(email);
    const [match] = await this.db
      .select({ customerId: customers.id, name: customers.name })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(customers.email, email), eq(orders.orderNumber, orderNumber)))
      .limit(1);
    if (!match) {
      this.failedLogins.recordFailure(email);
      throw new NotFoundException(SESSION_NOT_FOUND);
    }

    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + SESSION_TTL_SECONDS;
    return {
      token: signSessionToken({ sub: match.customerId, iat, exp }, this.secret),
      firstName: match.name.split(' ')[0],
      expiresAt: new Date(exp * 1000),
    };
  }

  async describe(customerId: string): Promise<{ firstName: string } | null> {
    const [customer] = await this.db.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
    return customer ? { firstName: customer.name.split(' ')[0] } : null;
  }
}
