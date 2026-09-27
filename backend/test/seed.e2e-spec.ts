import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { createPgPool } from '../src/database/database.js';
import { runMigrations } from '../src/database/run-migrations.js';
import * as schema from '../src/database/schema.js';
import { DEMO_CATALOG } from '../src/database/seed/demo-data.js';
import { seedDemoCatalog } from '../src/database/seed/seed.js';
import { wholeDaysBetween } from '../src/policy/policy-engine.js';
import { createTestDatabase, type TestDatabase } from './support/test-app.js';

const DAY_MS = 86_400_000;
const expectedOrders = DEMO_CATALOG.flatMap((c) => c.orders).length;
const expectedItems = DEMO_CATALOG.flatMap((c) => c.orders.flatMap((o) => o.items)).length;

describe('demo seed (e2e, real PostgreSQL)', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const now = new Date('2026-09-27T09:00:00Z');

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

  async function counts() {
    const [[c], [o], [i]] = await Promise.all([
      db.select({ n: count() }).from(schema.customers),
      db.select({ n: count() }).from(schema.orders),
      db.select({ n: count() }).from(schema.orderItems),
    ]);
    return { customers: c.n, orders: o.n, items: i.n };
  }

  async function deliveredAtOf(orderNumber: string) {
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.orderNumber, orderNumber));
    return order.deliveredAt;
  }

  it('loads every customer, order and item', async () => {
    const summary = await seedDemoCatalog(db, now);
    expect(summary).toEqual({ customers: 15, orders: expectedOrders, items: expectedItems });
    expect(await counts()).toEqual({ customers: 15, orders: expectedOrders, items: expectedItems });
  });

  it('stores dates so scenarios read correctly from the database', async () => {
    expect(wholeDaysBetween((await deliveredAtOf('WN-7K3P9Q'))!, now)).toBe(5); // Ada
    expect(wholeDaysBetween((await deliveredAtOf('WN-Q4M1ZT'))!, now)).toBe(45); // Ben
    expect(await deliveredAtOf('WN-K5R2BW')).toBeNull(); // Jide
  });

  it('is idempotent: running again duplicates nothing', async () => {
    await seedDemoCatalog(db, now);
    await seedDemoCatalog(db, now);
    expect(await counts()).toEqual({ customers: 15, orders: expectedOrders, items: expectedItems });
  });

  it('refreshes dates on a later run so the scenarios keep working', async () => {
    const later = new Date(now.getTime() + 10 * DAY_MS);
    await seedDemoCatalog(db, later);
    expect(wholeDaysBetween((await deliveredAtOf('WN-7K3P9Q'))!, later)).toBe(5);
  });

  it('never touches data that is not part of the demo catalog', async () => {
    const [other] = await db.insert(schema.customers).values({ name: 'Real Person', email: 'real@example.org' }).returning();
    await seedDemoCatalog(db, now);
    const [still] = await db.select().from(schema.customers).where(eq(schema.customers.id, other.id));
    expect(still.name).toBe('Real Person');
    expect((await counts()).customers).toBe(16);
  });

  it('rolls back completely if any row fails', async () => {
    const before = await counts();
    const broken = [{ ...DEMO_CATALOG[0], email: 'new.person@example.com', orders: [{ orderNumber: 'WN-BAD001', deliveredDaysAgo: 1, items: [{ sku: 'X', name: 'X', category: 'x', unitPricePaidMinor: 100, quantity: 0 }] }] }];
    await expect(seedDemoCatalog(db, now, broken)).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });
});
