import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { ClaimContext } from '../../refunds/submission/assessment-for-request.js';
import { conversations } from './conversations.table.js';
import { customers } from './customers.table.js';
import { orders } from './orders.table.js';
import { policyVersions } from './policy-versions.table.js';
import { refundReasonEnum, requestSourceEnum, requestStateEnum } from './refund-enums.js';

/**
 * One confirmed refund claim. The claim itself (order, items, reason) never changes after
 * submission; processing state and the decision live alongside it.
 */
export const refundRequests = pgTable(
  'refund_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Shown to customers and support ("rr_" + 12 random characters); never sequential.
    publicId: text('public_id').notNull().unique(),
    customerId: uuid('customer_id').notNull(),
    orderId: uuid('order_id').notNull(),
    // Captured at submission: a retry after a policy change still uses the original rules.
    policyVersionId: uuid('policy_version_id')
      .notNull()
      .references(() => policyVersions.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    reasonConfirmed: refundReasonEnum('reason_confirmed').notNull(),
    // What the AI understood before the customer confirmed (null for manual claims).
    aiProposal: jsonb('ai_proposal'),
    // The chat the claim came from; one conversation produces at most one request.
    conversationId: uuid('conversation_id')
      .unique()
      .references(() => conversations.id, { onDelete: 'restrict' }),
    // Snapshot taken at submission so retries and the sweeper decide identically.
    claimContext: jsonb('claim_context').$type<ClaimContext>(),
    // True when the customer changed the reason the AI proposed (sent to human review).
    reasonOverridden: boolean('reason_overridden').notNull().default(false),
    source: requestSourceEnum('source').notNull().default('CUSTOMER'),
    state: requestStateEnum('state').notNull().default('PROCESSING'),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The order must belong to the requesting customer, enforced by the database.
    foreignKey({
      name: 'refund_requests_order_customer_fk',
      columns: [t.orderId, t.customerId],
      foreignColumns: [orders.id, orders.customerId],
    }).onDelete('restrict'),
    foreignKey({ name: 'refund_requests_customer_fk', columns: [t.customerId], foreignColumns: [customers.id] }).onDelete('restrict'),
    // Idempotency: one request per customer per client-generated key.
    unique('refund_requests_customer_idempotency_unique').on(t.customerId, t.idempotencyKey),
    // Target for refund_request_lines' (request_id, order_id) foreign key.
    unique('refund_requests_id_order_id_unique').on(t.id, t.orderId),
    index('refund_requests_customer_created_idx').on(t.customerId, t.createdAt),
    index('refund_requests_order_id_idx').on(t.orderId),
    // The sweeper only ever scans requests still being processed.
    index('refund_requests_processing_lease_idx').on(t.leaseExpiresAt).where(sql`${t.state} = 'PROCESSING'`),
    check('refund_requests_public_id_format', sql`${t.publicId} ~ '^rr_[0-9a-hjkmnp-tv-z]{12}$'`),
    check('refund_requests_idempotency_key_length', sql`char_length(${t.idempotencyKey}) BETWEEN 1 AND 100`),
    check('refund_requests_payload_hash_format', sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
    check('refund_requests_attempts_positive', sql`${t.attemptCount} >= 1`),
    // A lease exists exactly while the request is PROCESSING.
    check(
      'refund_requests_lease_matches_state',
      sql`(${t.state} = 'PROCESSING') = (${t.leaseOwner} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`,
    ),
  ],
);
