import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { createPgPool, pgErrorCode, type Database } from '../src/database/database.providers.js';
import { runMigrations } from '../src/database/run-migrations.js';
import * as schema from '../src/database/schema.js';
import { seedDemoCatalog } from '../src/database/seed/seed.js';
import { generatePublicRequestId } from '../src/common/validation.js';
import { policyDocument, policyService } from './support/policy-fixtures.js';
import { createTestDatabase, type TestDatabase } from './support/test-app.js';

const CHECK = '23514';
const UNIQUE = '23505';
const FOREIGN_KEY = '23503';
const RESTRICT = '23001';
const HASH = 'a'.repeat(64);

describe('refund request schema (e2e, real PostgreSQL)', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: Database;
  let policyVersionId: string;

  // Two demo customers and their orders/items, looked up once.
  let ada: { id: string; orderId: string; itemId: string };
  let ben: { id: string; orderId: string; itemId: string };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    await runMigrations(testDb.url);
    pool = createPgPool(testDb.url);
    db = drizzle(pool, { schema });
    await seedDemoCatalog(db, new Date());
    policyVersionId = (await policyService(db).register(policyDocument('v1', '2026-01-01T00:00:00Z'))).policy.id;
    ada = await customerWithItem('ada.okafor@example.com', 'WN-7K3P9Q');
    ben = await customerWithItem('ben.carter@example.com', 'WN-Q4M1ZT');
  });

  afterAll(async () => {
    await pool?.end();
    await testDb?.drop();
  });

  async function customerWithItem(email: string, orderNumber: string) {
    const [row] = await db
      .select({ id: schema.customers.id, orderId: schema.orders.id, itemId: schema.orderItems.id })
      .from(schema.customers)
      .innerJoin(schema.orders, eq(schema.orders.customerId, schema.customers.id))
      .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
      .where(eq(schema.orders.orderNumber, orderNumber));
    return row;
  }

  async function codeOf(promise: Promise<unknown>) {
    try {
      await promise;
      return 'no error';
    } catch (error) {
      return pgErrorCode(error);
    }
  }

  function requestValues(overrides: Partial<typeof schema.refundRequests.$inferInsert> = {}) {
    return {
      publicId: generatePublicRequestId(),
      customerId: ada.id,
      orderId: ada.orderId,
      policyVersionId,
      idempotencyKey: crypto.randomUUID(),
      payloadHash: HASH,
      reasonConfirmed: 'DAMAGED' as const,
      leaseOwner: 'test-worker',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    };
  }

  async function newRequest(overrides: Partial<typeof schema.refundRequests.$inferInsert> = {}) {
    const [row] = await db.insert(schema.refundRequests).values(requestValues(overrides)).returning();
    return row;
  }

  describe('refund_requests', () => {
    it('accepts a valid PROCESSING request with a lease', async () => {
      const request = await newRequest();
      expect(request).toMatchObject({ state: 'PROCESSING', source: 'CUSTOMER', attemptCount: 1, reasonOverridden: false });
    });

    it("rejects a request for another customer's order", async () => {
      expect(await codeOf(newRequest({ customerId: ben.id, orderId: ada.orderId }))).toBe(FOREIGN_KEY);
    });

    it('rejects the same idempotency key twice for one customer, but not across customers', async () => {
      const key = crypto.randomUUID();
      await newRequest({ idempotencyKey: key });
      expect(await codeOf(newRequest({ idempotencyKey: key }))).toBe(UNIQUE);
      expect(await codeOf(newRequest({ idempotencyKey: key, customerId: ben.id, orderId: ben.orderId }))).toBe('no error');
    });

    it('rejects malformed public ids and payload hashes', async () => {
      expect(await codeOf(newRequest({ publicId: 'rr_0000000001' }))).toBe(CHECK);
      expect(await codeOf(newRequest({ publicId: 'rr_ILOUILOUILOU' }))).toBe(CHECK);
      expect(await codeOf(newRequest({ payloadHash: 'not-a-hash' }))).toBe(CHECK);
    });

    it('requires a lease exactly while PROCESSING', async () => {
      expect(await codeOf(newRequest({ leaseOwner: null, leaseExpiresAt: null }))).toBe(CHECK);
      expect(await codeOf(newRequest({ state: 'DECIDED' }))).toBe(CHECK);
      expect(await codeOf(newRequest({ state: 'DECIDED', leaseOwner: null, leaseExpiresAt: null }))).toBe('no error');
    });

    it('rejects an unknown reason', async () => {
      expect(await codeOf(pool.query(
        "INSERT INTO refund_requests (public_id, customer_id, order_id, policy_version_id, idempotency_key, payload_hash, reason_confirmed, lease_owner, lease_expires_at) VALUES ($1,$2,$3,$4,$5,$6,'VIP_REQUEST','w',now())",
        [generatePublicRequestId(), ada.id, ada.orderId, policyVersionId, 'k-enum', HASH],
      ))).toBe('22P02');
    });
  });

  describe('refund_request_lines', () => {
    it("rejects an item from a different order than the request's", async () => {
      const request = await newRequest();
      const attempt = db.insert(schema.refundRequestLines).values({
        requestId: request.id, orderId: ben.orderId, orderItemId: ben.itemId, quantity: 1, amountMinor: 3500,
      });
      expect(await codeOf(attempt)).toBe(FOREIGN_KEY);
      // Lying about the order id doesn't help either: the request is tied to its own order.
      const lying = db.insert(schema.refundRequestLines).values({
        requestId: request.id, orderId: ada.orderId, orderItemId: ben.itemId, quantity: 1, amountMinor: 3500,
      });
      expect(await codeOf(lying)).toBe(FOREIGN_KEY);
    });

    it('allows one line per item per request, with positive quantity and non-negative amount', async () => {
      const request = await newRequest();
      const line = { requestId: request.id, orderId: ada.orderId, orderItemId: ada.itemId, quantity: 1, amountMinor: 4999 };
      await db.insert(schema.refundRequestLines).values(line);
      expect(await codeOf(db.insert(schema.refundRequestLines).values(line))).toBe(UNIQUE);
      const other = await newRequest();
      expect(await codeOf(db.insert(schema.refundRequestLines).values({ ...line, requestId: other.id, quantity: 0 }))).toBe(CHECK);
      expect(await codeOf(db.insert(schema.refundRequestLines).values({ ...line, requestId: other.id, amountMinor: -1 }))).toBe(CHECK);
    });
  });

  describe('decisions', () => {
    const trace = {} as never;
    const decision = (requestId: string, overrides: Partial<typeof schema.decisions.$inferInsert> = {}) =>
      db.insert(schema.decisions).values({
        requestId, status: 'APPROVED', approvedAmountMinor: 4999, policyVersionId, ruleTrace: trace,
        customerMessage: 'Approved.', messageSource: 'TEMPLATE', ...overrides,
      });

    it('allows exactly one decision per request', async () => {
      const request = await newRequest();
      await decision(request.id);
      expect(await codeOf(decision(request.id))).toBe(UNIQUE);
    });

    it('only lets an approval carry money', async () => {
      expect(await codeOf(decision((await newRequest()).id, { status: 'DENIED', approvedAmountMinor: 100 }))).toBe(CHECK);
      expect(await codeOf(decision((await newRequest()).id, { status: 'DENIED', approvedAmountMinor: 0 }))).toBe('no error');
    });

    it('requires a reason for every escalation', async () => {
      const id = (await newRequest()).id;
      expect(await codeOf(decision(id, { status: 'ESCALATED', approvedAmountMinor: 0 }))).toBe(CHECK);
      expect(await codeOf(decision(id, { status: 'ESCALATED', approvedAmountMinor: 0, escalationReasons: ['HIGH_VALUE'] }))).toBe('no error');
    });
  });

  describe('review_resolutions', () => {
    const resolution = (requestId: string, overrides: Partial<typeof schema.reviewResolutions.$inferInsert> = {}) =>
      db.insert(schema.reviewResolutions).values({
        requestId, outcome: 'APPROVED', lineDecisions: [], approvedAmountMinor: 4999,
        reviewerNote: 'Photo confirms damage.', customerMessage: 'Approved after review.', ...overrides,
      });

    it('allows at most one resolution per request and requires a real note', async () => {
      const id = (await newRequest()).id;
      expect(await codeOf(resolution(id, { reviewerNote: '  ' }))).toBe(CHECK);
      await resolution(id);
      expect(await codeOf(resolution(id))).toBe(UNIQUE);
    });

    it('does not let a denial carry money', async () => {
      expect(await codeOf(resolution((await newRequest()).id, { outcome: 'DENIED', approvedAmountMinor: 10 }))).toBe(CHECK);
    });
  });

  describe('audit_events', () => {
    it('can be appended to', async () => {
      const request = await newRequest();
      await db.insert(schema.auditEvents).values({ requestId: request.id, type: 'REQUEST_RECEIVED', actor: 'CUSTOMER', data: { lines: 1 } });
      const rows = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, request.id));
      expect(rows).toHaveLength(1);
    });

    it('can never be updated, deleted or truncated', async () => {
      const request = await newRequest();
      await db.insert(schema.auditEvents).values({ requestId: request.id, type: 'REQUEST_RECEIVED', actor: 'CUSTOMER' });
      const where = eq(schema.auditEvents.requestId, request.id);
      expect(await codeOf(db.update(schema.auditEvents).set({ type: 'TAMPERED' }).where(where))).toBe(RESTRICT);
      expect(await codeOf(db.delete(schema.auditEvents).where(where))).toBe(RESTRICT);
      expect(await codeOf(db.execute(sql`TRUNCATE audit_events`))).toBe(RESTRICT);
    });

    it('keeps the request it refers to from being deleted', async () => {
      const request = await newRequest();
      await db.insert(schema.auditEvents).values({ requestId: request.id, type: 'REQUEST_RECEIVED', actor: 'CUSTOMER' });
      expect(await codeOf(db.delete(schema.refundRequests).where(eq(schema.refundRequests.id, request.id)))).toBe(FOREIGN_KEY);
    });
  });
});
