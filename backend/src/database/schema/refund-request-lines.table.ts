import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { orderItems } from './order-items.table.js';
import { lineStatusEnum, policyOutcomeEnum } from './refund-enums.js';
import { refundRequests } from './refund-requests.table.js';

/** One requested item. amountMinor is computed from the database, never taken from the client. */
export const refundRequestLines = pgTable(
  'refund_request_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull(),
    // Copied from the request so the two foreign keys below can tie item and request to one order.
    orderId: uuid('order_id').notNull(),
    orderItemId: uuid('order_item_id').notNull(),
    quantity: integer('quantity').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    lineOutcome: policyOutcomeEnum('line_outcome'),
    decidingRuleId: text('deciding_rule_id'),
    finalLineStatus: lineStatusEnum('final_line_status'),
  },
  (t) => [
    foreignKey({
      name: 'refund_request_lines_request_order_fk',
      columns: [t.requestId, t.orderId],
      foreignColumns: [refundRequests.id, refundRequests.orderId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'refund_request_lines_item_order_fk',
      columns: [t.orderItemId, t.orderId],
      foreignColumns: [orderItems.id, orderItems.orderId],
    }).onDelete('restrict'),
    unique('refund_request_lines_request_item_unique').on(t.requestId, t.orderItemId),
    index('refund_request_lines_order_item_idx').on(t.orderItemId),
    check('refund_request_lines_quantity_positive', sql`${t.quantity} > 0`),
    check('refund_request_lines_amount_non_negative', sql`${t.amountMinor} >= 0`),
  ],
);
