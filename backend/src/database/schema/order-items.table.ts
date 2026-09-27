import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { orders } from './orders.table.js';

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    // Money is integer minor units (cents): the price actually paid, after discounts.
    unitPricePaidMinor: integer('unit_price_paid_minor').notNull(),
    quantity: integer('quantity').notNull(),
    finalSale: boolean('final_sale').notNull().default(false),
  },
  (t) => [
    index('order_items_order_id_idx').on(t.orderId),
    // One line per product in an order; also lets seeding upsert items safely.
    uniqueIndex('order_items_order_id_sku_unique').on(t.orderId, t.sku),
    check('order_items_price_non_negative', sql`${t.unitPricePaidMinor} >= 0`),
    check('order_items_quantity_positive', sql`${t.quantity} > 0`),
  ],
);
