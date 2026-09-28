import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../database/database.providers.js';
import { orderItems, orders, refundRequestLines, refundRequests } from '../database/schema.js';
import type { CustomerOrdersResponseDto } from './dto/orders.dto.js';

export interface ItemQuantities {
  purchased: number;
  refunded: number;
  /** Under review or still processing: reserved, so it can't be requested twice. */
  pending: number;
  refundable: number;
}

/** refundable = purchased − refunded − pending. Denied quantities become refundable again. */
export function computeQuantities(
  purchased: readonly { id: string; quantity: number }[],
  used: readonly { orderItemId: string; refunded: number; pending: number }[],
): Map<string, ItemQuantities> {
  const usedById = new Map(used.map((u) => [u.orderItemId, u]));
  return new Map(
    purchased.map((item) => {
      const refunded = usedById.get(item.id)?.refunded ?? 0;
      const pending = usedById.get(item.id)?.pending ?? 0;
      return [item.id, { purchased: item.quantity, refunded, pending, refundable: Math.max(0, item.quantity - refunded - pending) }];
    }),
  );
}

@Injectable()
export class OrdersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The customer's orders, newest first, with what is still refundable per item. */
  async listForCustomer(customerId: string): Promise<CustomerOrdersResponseDto> {
    const orderRows = await this.db.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.placedAt));
    if (orderRows.length === 0) return { orders: [] };

    const itemRows = await this.db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderRows.map((o) => o.id)))
      .orderBy(asc(orderItems.name));
    const quantities = await this.itemQuantities(itemRows.map((i) => i.id));

    return {
      orders: orderRows.map((order) => ({
        orderNumber: order.orderNumber,
        placedAt: order.placedAt.toISOString(),
        deliveredAt: order.deliveredAt?.toISOString() ?? null,
        currency: order.currency,
        items: itemRows
          .filter((item) => item.orderId === order.id)
          .map((item) => {
            const q = quantities.get(item.id)!;
            return {
              id: item.id,
              name: item.name,
              quantity: item.quantity,
              unitPricePaidMinor: item.unitPricePaidMinor,
              finalSale: item.finalSale,
              refundedQuantity: q.refunded,
              pendingQuantity: q.pending,
              refundableQuantity: q.refundable,
            };
          }),
      })),
    };
  }

  /**
   * Refunded, reserved and refundable quantities per item. Pass a transaction as `db`
   * (after locking the item rows) to use the result as a reservation check.
   */
  async itemQuantities(orderItemIds: readonly string[], db: Database = this.db): Promise<Map<string, ItemQuantities>> {
    if (orderItemIds.length === 0) return new Map();
    const ids = [...orderItemIds];
    const purchased = await db.select({ id: orderItems.id, quantity: orderItems.quantity }).from(orderItems).where(inArray(orderItems.id, ids));
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
    return computeQuantities(purchased, used);
  }
}
