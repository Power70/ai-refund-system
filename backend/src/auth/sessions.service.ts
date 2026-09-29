import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, lt, or } from 'drizzle-orm';
import { DATABASE, type Database } from '../database/database.providers.js';
import { sessions } from '../database/schema.js';
import { hashSessionToken, isSessionToken, newSessionToken, SESSION_MAX_SECONDS, SESSION_TTL_SECONDS } from './session-token.js';

export type SessionKind = 'CUSTOMER' | 'ADMIN';

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

/** A live session: whose it is and, when it slid forward, the new expiry for the cookie. */
export interface VerifiedSession {
  customerId: string | null;
  renewedUntil: Date | null;
}

const seconds = (s: number) => s * 1000;

/** Server-side sessions: create on sign-in, check and slide on each request, delete on sign-out. */
@Injectable()
export class SessionsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(kind: SessionKind, customerId: string | null, now = new Date()): Promise<IssuedSession> {
    const token = newSessionToken();
    const expiresAt = new Date(now.getTime() + seconds(SESSION_TTL_SECONDS));
    const absoluteExpiresAt = new Date(now.getTime() + seconds(SESSION_MAX_SECONDS));
    await this.db.insert(sessions).values({ tokenHash: hashSessionToken(token), kind, customerId, createdAt: now, expiresAt, absoluteExpiresAt });
    return { token, expiresAt };
  }

  /**
   * The session for this cookie value, if it is of `kind` and still live. Once less than half the
   * idle window is left, the window restarts (never past the absolute lifetime).
   */
  async verify(kind: SessionKind, token: unknown, now = new Date()): Promise<VerifiedSession | null> {
    if (!isSessionToken(token)) return null;
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hashSessionToken(token)), eq(sessions.kind, kind), gt(sessions.expiresAt, now), gt(sessions.absoluteExpiresAt, now)));
    if (!row) return null;

    let renewedUntil: Date | null = null;
    if (row.expiresAt.getTime() - now.getTime() < seconds(SESSION_TTL_SECONDS) / 2) {
      const next = new Date(Math.min(now.getTime() + seconds(SESSION_TTL_SECONDS), row.absoluteExpiresAt.getTime()));
      if (next > row.expiresAt) {
        await this.db.update(sessions).set({ expiresAt: next }).where(eq(sessions.id, row.id));
        renewedUntil = next;
      }
    }
    return { customerId: row.customerId, renewedUntil };
  }

  /** Ends the session for this cookie value, if any. */
  async revoke(token: unknown): Promise<void> {
    if (isSessionToken(token)) await this.db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
  }

  /** Removes sessions that can no longer be used. Returns how many. */
  async purgeExpired(now = new Date()): Promise<number> {
    const removed = await this.db
      .delete(sessions)
      .where(or(lt(sessions.expiresAt, now), lt(sessions.absoluteExpiresAt, now)))
      .returning({ id: sessions.id });
    return removed.length;
  }
}
