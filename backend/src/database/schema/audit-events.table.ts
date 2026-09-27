import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditActorEnum } from './refund-enums.js';
import { refundRequests } from './refund-requests.table.js';

/**
 * Append-only history of everything that happened to a request. A database trigger
 * (migration 0003) rejects UPDATE, DELETE and TRUNCATE, so the trail can't be rewritten.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').references(() => refundRequests.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    actor: auditActorEnum('actor').notNull(),
    data: jsonb('data').notNull().default({}),
    correlationId: text('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_events_request_created_idx').on(t.requestId, t.createdAt)],
);
