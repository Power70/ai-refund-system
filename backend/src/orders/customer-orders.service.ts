import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { DATABASE } from '../database/database.tokens.js';
import type { Database } from '../database/database.types.js';
import { orderItems, orders } from '../database/schema/index.js';
import type { CustomerOrdersResponseDto } from './dto/customer-order.dto.js';
import { loadItemQuantities } from './load-item-quantities.js';

@Injectable()
export class CustomerOrdersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Only this customer's orders, newest first, with what is still refundable per item. */
  async list(customerId: string): Promise<CustomerOrdersResponseDto> {
    const orderRows = await this.db.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.placedAt));
    if (orderRows.length === 0) return { orders: [] };

    const itemRows = await this.db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderRows.map((o) => o.id)))
      .orderBy(asc(orderItems.name));
    const quantities = await loadItemQuantities(this.db, itemRows.map((i) => i.id));

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
}
