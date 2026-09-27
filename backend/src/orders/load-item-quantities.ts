import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../database/database.types.js';
import { orderItems, refundRequestLines, refundRequests } from '../database/schema/index.js';
import type { ItemQuantities } from './item-quantities.types.js';

/**
 * How much of each item is refunded, reserved and still refundable:
 *   refundable = purchased − refunded − under review − still processing.
 * Denied quantities become refundable again (a resubmission then goes to a person).
 * Pass a transaction as `db` (after locking the item rows) to use it as a reservation check.
 */
export async function loadItemQuantities(db: Database, orderItemIds: readonly string[]): Promise<Map<string, ItemQuantities>> {
  if (orderItemIds.length === 0) return new Map();
  const ids = [...orderItemIds];

  const purchased = await db
    .select({ id: orderItems.id, quantity: orderItems.quantity })
    .from(orderItems)
    .where(inArray(orderItems.id, ids));

  const used = await db
    .select({
      orderItemId: refundRequestLines.orderItemId,
      refunded: sql<number>`coalesce(sum(${refundRequestLines.quantity}) filter (where ${refundRequestLines.finalLineStatus} = 'REFUNDED'), 0)::int`,
      pending: sql<number>`coalesce(sum(${refundRequestLines.quantity}) filter (where ${refundRequestLines.finalLineStatus} = 'UNDER_REVIEW' or (${refundRequestLines.finalLineStatus} is null and ${refundRequests.state} = 'PROCESSING')), 0)::int`,
    })
    .from(refundRequestLines)
    .innerJoin(refundRequests, eq(refundRequests.id, refundRequestLines.requestId))
    .where(
      and(
        inArray(refundRequestLines.orderItemId, ids),
        or(
          inArray(refundRequestLines.finalLineStatus, ['REFUNDED', 'UNDER_REVIEW']),
          and(isNull(refundRequestLines.finalLineStatus), eq(refundRequests.state, 'PROCESSING')),
        ),
      ),
    )
    .groupBy(refundRequestLines.orderItemId);
  const usedById = new Map(used.map((u) => [u.orderItemId, u]));

  return new Map(
    purchased.map((item) => {
      const refunded = usedById.get(item.id)?.refunded ?? 0;
      const pending = usedById.get(item.id)?.pending ?? 0;
      return [item.id, { purchased: item.quantity, refunded, pending, refundable: Math.max(0, item.quantity - refunded - pending) }];
    }),
  );
}
