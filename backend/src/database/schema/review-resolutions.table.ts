import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { resolutionOutcomeEnum } from './refund-enums.js';
import { refundRequests } from './refund-requests.table.js';

export interface LineResolution {
  lineId: string;
  approve: boolean;
}

/** A support agent's decision on an escalated request: at most one, decided line by line. */
export const reviewResolutions = pgTable(
  'review_resolutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .unique()
      .references(() => refundRequests.id, { onDelete: 'restrict' }),
    outcome: resolutionOutcomeEnum('outcome').notNull(),
    lineDecisions: jsonb('line_decisions').$type<LineResolution[]>().notNull(),
    // Derived from the approved lines, never typed in by the reviewer.
    approvedAmountMinor: integer('approved_amount_minor').notNull(),
    reviewerNote: text('reviewer_note').notNull(),
    customerMessage: text('customer_message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('review_resolutions_amount_non_negative', sql`${t.approvedAmountMinor} >= 0`),
    check('review_resolutions_denied_has_no_amount', sql`${t.outcome} <> 'DENIED' OR ${t.approvedAmountMinor} = 0`),
    check('review_resolutions_note_required', sql`char_length(btrim(${t.reviewerNote})) >= 3`),
  ],
);
