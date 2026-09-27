import { sql } from 'drizzle-orm';
import { char, check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { customers } from './customers.table.js';

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Random, non-sequential (e.g. WN-7K3P9Q) so order numbers can't be guessed.
    orderNumber: text('order_number').notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull(),
    // Null until delivered. The refund window counts from delivery.
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    currency: char('currency', { length: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('orders_customer_id_idx').on(t.customerId),
    // Target for refund_requests' (order_id, customer_id) foreign key: the database itself
    // guarantees a refund request's order belongs to the requesting customer.
    unique('orders_id_customer_id_unique').on(t.id, t.customerId),
    check('orders_delivered_after_placed', sql`${t.deliveredAt} IS NULL OR ${t.deliveredAt} >= ${t.placedAt}`),
    check('orders_currency_upper', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);
