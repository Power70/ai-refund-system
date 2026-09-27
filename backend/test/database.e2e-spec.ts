import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { createPgPool, pgErrorCode } from '../src/database/database.js';
import { runMigrations } from '../src/database/run-migrations.js';
import * as schema from '../src/database/schema.js';
import { createTestDatabase, type TestDatabase } from './support/test-app.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

describe('database schema (e2e, real PostgreSQL)', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    await runMigrations(testDb.url);
    pool = createPgPool(testDb.url);
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool?.end();
    await testDb?.drop();
  });

  async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (error) {
      return pgErrorCode(error);
    }
    return 'no error';
  }

  async function newCustomer(email: string) {
    const [customer] = await db.insert(schema.customers).values({ name: 'Ada', email }).returning();
    return customer;
  }

  async function newOrder(customerId: string, orderNumber: string) {
    const placedAt = new Date('2026-09-01T10:00:00Z');
    const [order] = await db
      .insert(schema.orders)
      .values({ orderNumber, customerId, placedAt, deliveredAt: new Date('2026-09-03T10:00:00Z'), currency: 'USD' })
      .returning();
    return order;
  }

  it('creates every table', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'ai_calls', 'audit_events', 'conversation_messages', 'conversations', 'customers', 'decisions', 'order_items', 'orders',
      'policy_versions', 'refund_request_lines', 'refund_requests', 'review_resolutions',
    ]);
  });

  it('is safe to run the migrations again', async () => {
    await expect(runMigrations(testDb.url)).resolves.toBeUndefined();
  });

  it('round-trips a customer, order and item with generated ids and integer money', async () => {
    const customer = await newCustomer('roundtrip@example.com');
    const order = await newOrder(customer.id, 'WN-RT0001');
    await db.insert(schema.orderItems).values({
      orderId: order.id, sku: 'SHIRT-BLUE-M', name: 'Blue shirt', category: 'apparel', unitPricePaidMinor: 4999, quantity: 2,
    });
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ unitPricePaidMinor: 4999, quantity: 2, finalSale: false });
    expect(customer.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps emails unique and lower-case', async () => {
    await newCustomer('unique@example.com');
    expect(await codeOf(newCustomer('unique@example.com'))).toBe(UNIQUE_VIOLATION);
    expect(await codeOf(newCustomer('Mixed@Example.com'))).toBe(CHECK_VIOLATION);
  });

  it('keeps order numbers unique', async () => {
    const customer = await newCustomer('orders@example.com');
    await newOrder(customer.id, 'WN-DUP001');
    expect(await codeOf(newOrder(customer.id, 'WN-DUP001'))).toBe(UNIQUE_VIOLATION);
  });

  it('rejects an order delivered before it was placed', async () => {
    const customer = await newCustomer('timeline@example.com');
    const attempt = db.insert(schema.orders).values({
      orderNumber: 'WN-TIME01', customerId: customer.id, currency: 'USD',
      placedAt: new Date('2026-09-05T00:00:00Z'), deliveredAt: new Date('2026-09-01T00:00:00Z'),
    });
    expect(await codeOf(attempt)).toBe(CHECK_VIOLATION);
  });

  it('rejects a malformed currency code', async () => {
    const customer = await newCustomer('currency@example.com');
    const attempt = db.insert(schema.orders).values({
      orderNumber: 'WN-CUR001', customerId: customer.id, currency: 'usd', placedAt: new Date(),
    });
    expect(await codeOf(attempt)).toBe(CHECK_VIOLATION);
  });

  it('rejects zero quantity and negative prices', async () => {
    const customer = await newCustomer('items@example.com');
    const order = await newOrder(customer.id, 'WN-ITEM01');
    const base = { orderId: order.id, sku: 'X', name: 'X', category: 'general' };
    expect(await codeOf(db.insert(schema.orderItems).values({ ...base, unitPricePaidMinor: 100, quantity: 0 }))).toBe(CHECK_VIOLATION);
    expect(await codeOf(db.insert(schema.orderItems).values({ ...base, unitPricePaidMinor: -1, quantity: 1 }))).toBe(CHECK_VIOLATION);
  });

  it('rejects items for an order that does not exist', async () => {
    const attempt = db.insert(schema.orderItems).values({
      orderId: '00000000-0000-4000-8000-000000000000', sku: 'X', name: 'X', category: 'general', unitPricePaidMinor: 1, quantity: 1,
    });
    expect(await codeOf(attempt)).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('refuses to delete a customer who has orders', async () => {
    const customer = await newCustomer('keep@example.com');
    await newOrder(customer.id, 'WN-KEEP01');
    expect(await codeOf(db.delete(schema.customers).where(eq(schema.customers.id, customer.id)))).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('keeps policy version labels and content hashes unique', async () => {
    const content = { version: 'v1' } as never;
    const row = { version: 'v1', contentHash: 'hash-1', content, effectiveFrom: new Date() };
    await db.insert(schema.policyVersions).values(row);
    expect(await codeOf(db.insert(schema.policyVersions).values({ ...row, contentHash: 'hash-2' }))).toBe(UNIQUE_VIOLATION);
    expect(await codeOf(db.insert(schema.policyVersions).values({ ...row, version: 'v2' }))).toBe(UNIQUE_VIOLATION);
  });
});
