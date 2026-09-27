import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';
import { DEMO_CATALOG } from './demo-catalog.js';
import type { DemoCustomer } from './demo-catalog.types.js';
import { demoOrderDates } from './demo-order-dates.js';

export interface SeedSummary {
  customers: number;
  orders: number;
  items: number;
}

/**
 * Upserts the demo customers, orders and items in one transaction.
 * Safe to run on every startup: existing rows are updated (dates refreshed relative to
 * `now` so every scenario keeps working), nothing is duplicated, and rows that are not
 * part of the demo catalog are never touched.
 */
export async function seedDemoCatalog(
  db: NodePgDatabase<typeof schema>,
  now: Date,
  catalog: readonly DemoCustomer[] = DEMO_CATALOG,
): Promise<SeedSummary> {
  const summary: SeedSummary = { customers: 0, orders: 0, items: 0 };

  await db.transaction(async (tx) => {
    for (const demo of catalog) {
      const [customer] = await tx
        .insert(schema.customers)
        .values({ name: demo.name, email: demo.email.toLowerCase() })
        .onConflictDoUpdate({ target: schema.customers.email, set: { name: demo.name } })
        .returning({ id: schema.customers.id });
      summary.customers++;

      for (const demoOrder of demo.orders) {
        const dates = demoOrderDates(demoOrder.deliveredDaysAgo, now);
        const [order] = await tx
          .insert(schema.orders)
          .values({ orderNumber: demoOrder.orderNumber, customerId: customer.id, currency: 'USD', ...dates })
          .onConflictDoUpdate({
            target: schema.orders.orderNumber,
            set: { customerId: customer.id, placedAt: dates.placedAt, deliveredAt: dates.deliveredAt },
          })
          .returning({ id: schema.orders.id });
        summary.orders++;

        for (const item of demoOrder.items) {
          const values = { ...item, finalSale: item.finalSale ?? false };
          await tx
            .insert(schema.orderItems)
            .values({ orderId: order.id, ...values })
            .onConflictDoUpdate({
              target: [schema.orderItems.orderId, schema.orderItems.sku],
              set: {
                name: values.name,
                category: values.category,
                unitPricePaidMinor: values.unitPricePaidMinor,
                quantity: values.quantity,
                finalSale: values.finalSale,
              },
            });
          summary.items++;
        }
      }
    }
  });

  return summary;
}
