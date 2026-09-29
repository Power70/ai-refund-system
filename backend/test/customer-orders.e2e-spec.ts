import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import request from 'supertest';
import { createPgPool } from '../src/database/database.providers.js';
import * as schema from '../src/database/schema.js';
import { generatePublicRequestId } from '../src/common/validation.js';
import { createTestApp } from './create-test-app.js';
import { demoOrder, prepareDemoDatabase, signIn, type TestDatabase } from './support/test-app.js';

const ORDERS = '/api/v1/customer/orders';

interface ItemView { name: string; quantity: number; refundedQuantity: number; pendingQuantity: number; refundableQuantity: number }
interface OrderView { orderNumber: string; items: ItemView[] }

describe('customer orders (e2e)', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    db = await prepareDemoDatabase();
    app = await createTestApp(db.url);
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  async function ordersFor(email: string): Promise<OrderView[]> {
    const cookie = await signIn(app, email);
    const res = await request(app.getHttpServer()).get(ORDERS).set('Cookie', cookie).expect(200);
    return res.body.orders as OrderView[];
  }

  const item = (orders: OrderView[], name: string) => orders.flatMap((o) => o.items).find((i) => i.name === name)!;

  it('requires a session', async () => {
    await request(app.getHttpServer()).get(ORDERS).expect(401);
  });

  it("shows only the signed-in customer's orders, newest first", async () => {
    const orders = await ordersFor('ada.okafor@example.com');
    expect(orders.map((o) => o.orderNumber)).toEqual(['WN-7K3P9Q', 'WN-2HX8LD']);
  });

  it('exposes no email, customer id or internal order id', async () => {
    const cookie = await signIn(app, 'ada.okafor@example.com');
    const res = await request(app.getHttpServer()).get(ORDERS).set('Cookie', cookie).expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('@');
    expect(Object.keys(res.body.orders[0]).sort()).toEqual(['currency', 'deliveredAt', 'items', 'orderNumber', 'placedAt']);
    expect(Object.keys(res.body.orders[0].items[0]).sort()).toEqual([
      'finalSale', 'id', 'name', 'pendingQuantity', 'quantity', 'refundableQuantity', 'refundedQuantity', 'unitPricePaidMinor',
    ]);
  });

  it('#15 Obi: the refunded kettle has nothing left; the toaster is refundable', async () => {
    const orders = await ordersFor('obi.chukwu@example.com');
    expect(item(orders, 'Electric kettle, 1 L')).toMatchObject({ quantity: 1, refundedQuantity: 1, refundableQuantity: 0 });
    expect(item(orders, 'Toaster, 2-slice')).toMatchObject({ refundableQuantity: 1 });
  });

  it('#9 Ifeoma: all three pillows refunded; the candle is untouched', async () => {
    const orders = await ordersFor('ifeoma.nwosu@example.com');
    expect(item(orders, 'Memory foam pillow')).toMatchObject({ quantity: 3, refundedQuantity: 3, refundableQuantity: 0 });
    expect(item(orders, 'Soy candle, vanilla')).toMatchObject({ refundableQuantity: 1 });
  });

  it('#8 Hassan: a denied item can be requested again', async () => {
    const orders = await ordersFor('hassan.bello@example.com');
    expect(item(orders, 'Over-ear headphones')).toMatchObject({ refundedQuantity: 0, pendingQuantity: 0, refundableQuantity: 1 });
  });

  it('#6 Femi: the chair is refunded, the mat is still refundable', async () => {
    const orders = await ordersFor('femi.johnson@example.com');
    expect(item(orders, 'Ergonomic office chair')).toMatchObject({ refundedQuantity: 1, refundableQuantity: 0 });
    expect(item(orders, 'Standing desk mat, XL')).toMatchObject({ refundableQuantity: 1 });
  });

  it('reserves quantity while a request is still processing', async () => {
    const pool = createPgPool(db.url);
    const database = drizzle(pool, { schema });
    const order = await demoOrder(database, 'WN-7XW2QD', ['BOTTLE-STL-750']);
    const [version] = await database.select().from(schema.policyVersions).limit(1);
    const [req] = await database.insert(schema.refundRequests).values({
      publicId: generatePublicRequestId(), customerId: order.customerId, orderId: order.orderId, policyVersionId: version.id,
      idempotencyKey: 'k1', payloadHash: 'c'.repeat(64), reasonConfirmed: 'DAMAGED', leaseOwner: 'w', leaseExpiresAt: new Date(Date.now() + 60_000),
    }).returning();
    await database.insert(schema.refundRequestLines).values({ requestId: req.id, orderId: order.orderId, orderItemId: order.itemIds[0], quantity: 1, amountMinor: 5500 });

    expect(item(await ordersFor('lara.smith@example.com'), 'Steel water bottle, 750 ml')).toMatchObject({ pendingQuantity: 1, refundableQuantity: 0 });

    // Once decided and denied, the quantity is free again.
    await database.update(schema.refundRequestLines).set({ finalLineStatus: 'NOT_REFUNDED' }).where(eq(schema.refundRequestLines.requestId, req.id));
    await database.update(schema.refundRequests).set({ state: 'DECIDED', leaseOwner: null, leaseExpiresAt: null }).where(eq(schema.refundRequests.id, req.id));
    expect(item(await ordersFor('lara.smith@example.com'), 'Steel water bottle, 750 ml')).toMatchObject({ pendingQuantity: 0, refundableQuantity: 1 });
    await pool.end();
  });
});
