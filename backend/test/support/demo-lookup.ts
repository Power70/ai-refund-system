import { and, eq } from 'drizzle-orm';
import type { Database } from '../../src/database/database.types.js';
import * as schema from '../../src/database/schema/index.js';

/** Finds a demo customer's order and the item ids for the given SKUs. */
export async function demoOrder(db: Database, orderNumber: string, skus: string[]) {
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.orderNumber, orderNumber));
  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
  const itemIds = skus.map((sku) => {
    const item = items.find((i) => i.sku === sku);
    if (!item) throw new Error(`${sku} not in ${orderNumber}`);
    return item.id;
  });
  return { orderId: order.id, customerId: order.customerId, itemIds, items };
}

export async function requestByPublicId(db: Database, publicId: string) {
  const [request] = await db.select().from(schema.refundRequests).where(eq(schema.refundRequests.publicId, publicId));
  const [decision] = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, request.id));
  const lines = await db.select().from(schema.refundRequestLines).where(and(eq(schema.refundRequestLines.requestId, request.id)));
  const [resolution] = await db.select().from(schema.reviewResolutions).where(eq(schema.reviewResolutions.requestId, request.id));
  return { request, decision, lines, resolution };
}
