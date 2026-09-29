import type { NestExpressApplication } from '@nestjs/platform-express';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { createPgPool, pgErrorCode, type Database } from '../src/database/database.providers.js';
import * as schema from '../src/database/schema.js';
import { HealthService } from '../src/health/health.service.js';
import { SYSTEM_FAILURE_CUSTOMER_MESSAGE } from '../src/refunds/customer-messages.service.js';
import { DecisionService } from '../src/refunds/decision.service.js';
import { RefundsService } from '../src/refunds/refunds.service.js';
import { SweeperService } from '../src/refunds/sweeper.service.js';
import { createTestApp, type TestAppOptions } from './create-test-app.js';
import { prepareDemoDatabase, strandedRequest, type TestDatabase } from './support/test-app.js';

const EXPIRED = () => new Date(Date.now() - 1_000);
const LIVE = () => new Date(Date.now() + 60_000);

/** A demo database, the app's services wired against it, and a direct connection for assertions. */
async function openDemo(options: TestAppOptions = {}) {
  const testDb = await prepareDemoDatabase();
  const app = await createTestApp(testDb.url, options);
  const pool = createPgPool(testDb.url);
  return {
    testDb,
    app,
    pool,
    db: drizzle(pool, { schema }) as Database,
    sweeper: app.get(SweeperService),
    decisions: app.get(DecisionService),
    refunds: app.get(RefundsService),
    health: app.get(HealthService),
  };
}

async function stateOf(db: Database, id: string) {
  const [request] = await db.select().from(schema.refundRequests).where(eq(schema.refundRequests.id, id));
  const decisions = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, id));
  const lines = await db.select().from(schema.refundRequestLines).where(eq(schema.refundRequestLines.requestId, id));
  const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, id)).orderBy(asc(schema.auditEvents.createdAt));
  return { request, decisions, lines, audit: audit.map((a) => a.type) };
}

describe('request sweeper (e2e, real PostgreSQL)', () => {
  let testDb: TestDatabase;
  let app: NestExpressApplication;
  let pool: pg.Pool;
  let db: Database;
  let sweeper: SweeperService;
  let decisions: DecisionService;
  let refunds: RefundsService;
  let health: HealthService;

  beforeAll(async () => ({ testDb, app, pool, db, sweeper, decisions, refunds, health } = await openDemo()));
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await testDb?.drop();
  });

  it('finishes a request whose worker died, with the normal decision', async () => {
    const stuck = await strandedRequest(db, { orderNumber: 'WN-Q4M1ZT', sku: 'LAMP-DSK-BLK', reason: 'DAMAGED', leaseExpiresAt: EXPIRED() });
    const result = await sweeper.sweepOnce();
    expect(result).toMatchObject({ found: 1, decided: 1, escalated: 0 });

    const { request, decisions, lines, audit } = await stateOf(db, stuck.id);
    expect(request).toMatchObject({ state: 'DECIDED', attemptCount: 2, leaseOwner: null });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ status: 'DENIED' }); // #2 Ben: outside the window
    expect(lines[0].finalLineStatus).toBe('NOT_REFUNDED');
    expect(audit).toEqual(['PROCESSING_RESUMED', 'POLICY_EVALUATED', 'SAFETY_GATE_APPLIED', 'DECISION_RECORDED']);
  });

  it('tags the audit events of each pass with one sweep ID', async () => {
    const stuck = await strandedRequest(db, { orderNumber: 'WN-9TB6RW', sku: 'BELT-LTH-BRN', reason: 'CHANGED_MIND', leaseExpiresAt: EXPIRED() });
    await sweeper.sweep();
    const ids = (await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, stuck.id))).filter((a) => a.type !== 'REQUEST_RECEIVED').map((a) => a.correlationId);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^sweep-[0-9a-f-]{36}$/);
  });

  it('leaves a request alone while its worker still holds the lease', async () => {
    const busy = await strandedRequest(db, { orderNumber: 'WN-7K3P9Q', sku: 'SHIRT-OXF-BLU-M', reason: 'DAMAGED', leaseExpiresAt: LIVE() });
    expect((await sweeper.sweepOnce()).found).toBe(0);
    expect((await stateOf(db, busy.id)).request).toMatchObject({ state: 'PROCESSING', leaseOwner: 'dead-worker', attemptCount: 1 });
  });

  it('hands a request to a person after 3 failed attempts', async () => {
    const worn = await strandedRequest(db, { orderNumber: 'WN-2JC8WP', sku: 'TABLET-10-128', reason: 'DAMAGED', leaseExpiresAt: EXPIRED(), attemptCount: 3 });
    expect(await sweeper.sweepOnce()).toMatchObject({ found: 1, escalated: 1, decided: 0 });

    const { request, decisions, lines, audit } = await stateOf(db, worn.id);
    expect(request.state).toBe('DECIDED');
    expect(decisions[0]).toMatchObject({ status: 'ESCALATED', ruleTrace: null, escalationReasons: ['SYSTEM_PROCESSING_FAILURE'], approvedAmountMinor: 0 });
    expect(lines[0].finalLineStatus).toBe('UNDER_REVIEW'); // stays reserved for the reviewer
    expect(audit).toEqual(['PROCESSING_RESUMED', 'SYSTEM_PROCESSING_FAILED', 'DECISION_RECORDED']);

    const view = await refunds.view(request.customerId, { requestId: request.id });
    expect(view).toMatchObject({ status: 'ESCALATED', customerMessage: SYSTEM_FAILURE_CUSTOMER_MESSAGE });
  });

  it('decides each request exactly once when several sweepers run at the same time', async () => {
    const stuck = await strandedRequest(db, { orderNumber: 'WN-7XW2QD', sku: 'BOTTLE-STL-750', reason: 'DAMAGED', leaseExpiresAt: EXPIRED() });
    const results = await Promise.all([sweeper.sweepOnce(), sweeper.sweepOnce(), sweeper.sweepOnce()]);
    expect(results.reduce((n, r) => n + r.decided, 0)).toBe(1);
    const { decisions, audit } = await stateOf(db, stuck.id);
    expect(decisions).toHaveLength(1);
    expect(audit.filter((t) => t === 'PROCESSING_RESUMED')).toHaveLength(1);
  });

  it('lets only one caller take over an expired lease (retry vs sweeper, sweeper vs sweeper)', async () => {
    const stuck = await strandedRequest(db, { orderNumber: 'WN-3VH9TL', sku: 'SHIRT-POL-GRN-M', reason: 'CHANGED_MIND', leaseExpiresAt: EXPIRED() });
    const first = await decisions.reclaimExpiredLease(stuck.id);
    const second = await decisions.reclaimExpiredLease(stuck.id); // the lease was just renewed: nothing to take
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect((await stateOf(db, stuck.id)).request).toMatchObject({ leaseOwner: first, attemptCount: 2 });
  });

  it('a worker whose lease was taken over cannot save a decision', async () => {
    const stuck = await strandedRequest(db, { orderNumber: 'WN-H9F3LX', sku: 'KETTLE-ELC-1L', reason: 'DAMAGED', leaseExpiresAt: EXPIRED() });
    const newOwner = await decisions.reclaimExpiredLease(stuck.id);
    expect(newOwner).not.toBeNull();
    // The original worker ('dead-worker') wakes up and tries to finish: refused, nothing written.
    expect(await decisions.decide(stuck.id, 'dead-worker')).toBe(false);
    expect((await stateOf(db, stuck.id)).decisions).toHaveLength(0);
    // The current owner can.
    expect(await decisions.decide(stuck.id, newOwner!)).toBe(true);
    expect((await stateOf(db, stuck.id)).decisions).toHaveLength(1);
  });

  it('counts stuck requests (the health signal) and reaches zero after a sweep', async () => {
    await strandedRequest(db, { orderNumber: 'WN-B4N6ZR', sku: 'BAG-BPK-GRY', reason: 'DAMAGED', leaseExpiresAt: EXPIRED() });
    expect(await health.countStuckRequests()).toBe(1);
    await sweeper.sweepOnce();
    expect(await health.countStuckRequests()).toBe(0);
  });

  it('the database refuses a decision without a rule trace unless it is a system-failure escalation', async () => {
    const stuck = await strandedRequest(db, { orderNumber: 'WN-X8D3KF', sku: 'JKT-DNM-IND-L', reason: 'DAMAGED', leaseExpiresAt: LIVE() });
    const [version] = await db.select().from(schema.policyVersions).limit(1);
    let code: string | undefined;
    try {
      await db.insert(schema.decisions).values({
        requestId: stuck.id, status: 'DENIED', policyVersionId: version.id, ruleTrace: null, customerMessage: 'x', messageSource: 'TEMPLATE',
      });
    } catch (error) {
      code = pgErrorCode(error);
    }
    expect(code).toBe('23514');
  });
});

describe('request sweeper when deciding keeps failing (e2e)', () => {
  let testDb: TestDatabase;
  let app: NestExpressApplication;
  let pool: pg.Pool;
  let db: Database;
  let sweeper: SweeperService;

  beforeAll(async () => ({ testDb, app, pool, db, sweeper } = await openDemo()));
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await testDb?.drop();
  });

  it('retries on later passes, then escalates after the third failed attempt', async () => {
    const stuck = await strandedRequest(db, { orderNumber: 'WN-6PQ8XE', sku: 'CANDLE-SOY-VAN', reason: 'DAMAGED', leaseExpiresAt: EXPIRED() });
    // Make every decision attempt fail: the stored policy no longer passes its integrity check.
    await pool.query("UPDATE policy_versions SET content = jsonb_set(content, '{defaultOutcome}', '\"ALLOW\"')");

    const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    expect(await sweeper.sweepOnce(later(0))).toMatchObject({ found: 1, retryLater: 1 }); // attempt 2 fails
    expect(await sweeper.sweepOnce(later(0))).toMatchObject({ found: 0 }); // new lease still valid
    expect(await sweeper.sweepOnce(later(2))).toMatchObject({ found: 1, retryLater: 1 }); // attempt 3 fails
    expect(await sweeper.sweepOnce(later(4))).toMatchObject({ found: 1, escalated: 1 }); // a person takes it

    const { request, decisions } = await stateOf(db, stuck.id);
    expect(request).toMatchObject({ state: 'DECIDED', attemptCount: 4 });
    expect(decisions[0].escalationReasons).toEqual(['SYSTEM_PROCESSING_FAILURE']);
  });
});

describe('background sweeper in the running API (e2e)', () => {
  it('picks up a stuck request on its own', async () => {
    const { testDb, app, pool, db } = await openDemo({ sweeperIntervalMs: 100 });
    try {
      const stuck = await strandedRequest(db, { orderNumber: 'WN-K5R2BW', sku: 'SPEAKER-BT-MINI', reason: 'DAMAGED', leaseExpiresAt: EXPIRED() });
      const deadline = Date.now() + 5_000;
      while ((await stateOf(db, stuck.id)).request.state === 'PROCESSING' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const { request, decisions } = await stateOf(db, stuck.id);
      expect(request.state).toBe('DECIDED');
      expect(decisions[0]).toMatchObject({ status: 'ESCALATED', escalationReasons: ['NOT_DELIVERED'] }); // #10 Jide
    } finally {
      await app.close();
      await pool.end();
      await testDb.drop();
    }
  });
});
