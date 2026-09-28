import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { createPgPool, type Database } from '../src/database/database.providers.js';
import { runMigrations } from '../src/database/run-migrations.js';
import * as schema from '../src/database/schema.js';
import { seedDemoCatalog } from '../src/database/seed/seed.js';
import { generatePublicRequestId } from '../src/common/validation.js';
import { ItemNotInOrderError, RequestFactsService } from '../src/refunds/request-facts.service.js';
import { policyDocument, policyService } from './support/policy-fixtures.js';
import { demoOrder, createTestDatabase, type TestDatabase } from './support/test-app.js';

const DAY_MS = 86_400_000;

describe('RequestFactsService (e2e, real PostgreSQL)', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: Database;
  let factsService: RequestFactsService;
  let policyVersionId: string;
  const now = new Date();

  beforeEach(async () => {
    testDb = await createTestDatabase();
    await runMigrations(testDb.url);
    pool = createPgPool(testDb.url);
    db = drizzle(pool, { schema });
    factsService = new RequestFactsService(db);
    await seedDemoCatalog(db, now);
    policyVersionId = (await policyService(db).register(policyDocument('v1', '2026-01-01T00:00:00Z'))).policy.id;
  });

  afterEach(async () => {
    await pool?.end();
    await testDb?.drop();
  });

  /** Inserts a prior request with lines in the given state, created at `at`. */
  async function priorRequest(order: Awaited<ReturnType<typeof demoOrder>>, at: Date, lines: { itemId: string; amount: number; status: 'REFUNDED' | 'NOT_REFUNDED' | 'UNDER_REVIEW' | null }[], state: 'DECIDED' | 'PROCESSING' = 'DECIDED') {
    const [request] = await db.insert(schema.refundRequests).values({
      publicId: generatePublicRequestId(), customerId: order.customerId, orderId: order.orderId, policyVersionId,
      idempotencyKey: crypto.randomUUID(), payloadHash: 'b'.repeat(64), reasonConfirmed: 'DAMAGED', state, createdAt: at,
      leaseOwner: state === 'PROCESSING' ? 'w' : null, leaseExpiresAt: state === 'PROCESSING' ? new Date(now.getTime() + 60_000) : null,
    }).returning();
    for (const l of lines) {
      await db.insert(schema.refundRequestLines).values({ requestId: request.id, orderId: order.orderId, orderItemId: l.itemId, quantity: 1, amountMinor: l.amount, finalLineStatus: l.status });
    }
    return request;
  }

  it('computes item facts and amounts from the database', async () => {
    const order = await demoOrder(db, 'WN-3VH9TL', ['SHIRT-POL-GRN-M', 'BELT-CNV-NVY']);
    const facts = await factsService.build({
      customerId: order.customerId, orderId: order.orderId, reason: 'CHANGED_MIND', at: now,
      lines: [{ orderItemId: order.itemIds[0], quantity: 1 }, { orderItemId: order.itemIds[1], quantity: 1 }],
    });
    expect(facts.lines.map((l) => [l.amountMinor, l.facts['item.finalSale'], l.facts['item.daysSinceDelivery']])).toEqual([
      [4500, false, 7],
      [2500, true, 7],
    ]);
    expect(facts.lines[0].facts['claim.reason']).toBe('CHANGED_MIND');
    expect(facts.history).toEqual({ 'order.refundedOrPendingMinor': 0, 'customer.requestsLast30Days': 0 });
  });

  it('multiplies price by quantity', async () => {
    const order = await demoOrder(db, 'WN-9MA3CJ', ['PILLOW-MEM-STD']);
    const facts = await factsService.build({ customerId: order.customerId, orderId: order.orderId, reason: 'DAMAGED', at: now, lines: [{ orderItemId: order.itemIds[0], quantity: 2 }] });
    expect(facts.lines[0].amountMinor).toBe(7600);
  });

  it('reports undelivered items as not delivered with no day count', async () => {
    const order = await demoOrder(db, 'WN-K5R2BW', ['SPEAKER-BT-MINI']);
    const facts = await factsService.build({ customerId: order.customerId, orderId: order.orderId, reason: 'DAMAGED', at: now, lines: [{ orderItemId: order.itemIds[0], quantity: 1 }] });
    expect(facts.lines[0].facts).toMatchObject({ 'item.delivered': false, 'item.daysSinceDelivery': null });
  });

  it("refuses items from another order and another customer's order", async () => {
    const ada = await demoOrder(db, 'WN-7K3P9Q', ['SHIRT-OXF-BLU-M']);
    const ben = await demoOrder(db, 'WN-Q4M1ZT', ['LAMP-DSK-BLK']);
    const lines = [{ orderItemId: ben.itemIds[0], quantity: 1 }];
    await expect(factsService.build({ customerId: ada.customerId, orderId: ada.orderId, reason: 'DAMAGED', at: now, lines })).rejects.toThrow(ItemNotInOrderError);
    await expect(factsService.build({ customerId: ada.customerId, orderId: ben.orderId, reason: 'DAMAGED', at: now, lines })).rejects.toThrow(ItemNotInOrderError);
  });

  it('counts refunded, under-review and still-processing money on the order, but not denied lines', async () => {
    const order = await demoOrder(db, 'WN-8NF4QA', ['CHAIR-OFF-ERG', 'DESK-MAT-XL']);
    const [chair, mat] = order.itemIds;
    await priorRequest(order, new Date(now.getTime() - DAY_MS), [{ itemId: chair, amount: 30000, status: 'REFUNDED' }]);
    await priorRequest(order, new Date(now.getTime() - DAY_MS), [{ itemId: mat, amount: 1000, status: 'UNDER_REVIEW' }]);
    await priorRequest(order, new Date(now.getTime() - DAY_MS), [{ itemId: mat, amount: 200, status: null }], 'PROCESSING');
    await priorRequest(order, new Date(now.getTime() - DAY_MS), [{ itemId: mat, amount: 99999, status: 'NOT_REFUNDED' }]);
    const facts = await factsService.build({ customerId: order.customerId, orderId: order.orderId, reason: 'DAMAGED', at: now, lines: [{ orderItemId: mat, quantity: 1 }] });
    expect(facts.history['order.refundedOrPendingMinor']).toBe(31200);
    expect(facts.lines[0].facts['item.priorDeniedRequest']).toBe(true);
    expect(facts.history['customer.requestsLast30Days']).toBe(4);
  });

  it('excludes the request being judged from its own history', async () => {
    const order = await demoOrder(db, 'WN-8NF4QA', ['DESK-MAT-XL']);
    const current = await priorRequest(order, now, [{ itemId: order.itemIds[0], amount: 28000, status: null }], 'PROCESSING');
    const facts = await factsService.build({ customerId: order.customerId, orderId: order.orderId, reason: 'DAMAGED', at: now, excludeRequestId: current.id, lines: [{ orderItemId: order.itemIds[0], quantity: 1 }] });
    expect(facts.history).toEqual({ 'order.refundedOrPendingMinor': 0, 'customer.requestsLast30Days': 0 });
  });

  it('counts requests in the 30 days before `at` only (not older, not later)', async () => {
    const order = await demoOrder(db, 'WN-6PQ8XE', ['CANDLE-SOY-VAN']);
    const other = await demoOrder(db, 'WN-9MA3CJ', ['PILLOW-MEM-STD']);
    await priorRequest(other, new Date(now.getTime() - 30 * DAY_MS), []); // exactly 30 days: outside
    await priorRequest(other, new Date(now.getTime() - 30 * DAY_MS + 60_000), []); // just inside
    await priorRequest(other, new Date(now.getTime() - DAY_MS), []);
    await priorRequest(other, new Date(now.getTime() + DAY_MS), []); // after `at`: not history
    const facts = await factsService.build({ customerId: order.customerId, orderId: order.orderId, reason: 'DAMAGED', at: now, lines: [{ orderItemId: order.itemIds[0], quantity: 1 }] });
    expect(facts.history['customer.requestsLast30Days']).toBe(2);
  });

  it('ignores other orders when adding up money', async () => {
    const order = await demoOrder(db, 'WN-9MA3CJ', ['PILLOW-MEM-STD']);
    const other = await demoOrder(db, 'WN-1YD4GU', ['TOWEL-BTH-SET']);
    await priorRequest(other, new Date(now.getTime() - DAY_MS), [{ itemId: other.itemIds[0], amount: 4500, status: 'REFUNDED' }]);
    const facts = await factsService.build({ customerId: order.customerId, orderId: order.orderId, reason: 'DAMAGED', at: now, lines: [{ orderItemId: order.itemIds[0], quantity: 1 }] });
    expect(facts.history['order.refundedOrPendingMinor']).toBe(0);
  });

  it('uses a line id equal to the order item id', async () => {
    const order = await demoOrder(db, 'WN-7K3P9Q', ['SHIRT-OXF-BLU-M']);
    const facts = await factsService.build({ customerId: order.customerId, orderId: order.orderId, reason: 'DAMAGED', at: now, lines: [{ orderItemId: order.itemIds[0], quantity: 1 }] });
    const [row] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.id, facts.lines[0].lineId));
    expect(row.sku).toBe('SHIRT-OXF-BLU-M');
  });
});
