import { sql } from 'drizzle-orm';
import { correlationId } from '../common/correlation.js';
import { pgEnum, check, pgTable, text, timestamp, uuid, char, index, unique, boolean, integer, uniqueIndex, jsonb, foreignKey } from 'drizzle-orm/pg-core';
import type { RequestEvaluation } from '../policy/policy-engine.js';
import { POLICY_OUTCOMES, REFUND_REASONS, type PolicyDocument } from '../policy/policy-schema.js';
import type { ClaimContext } from '../refunds/decision.rules.js';

export const refundReasonEnum = pgEnum('refund_reason', REFUND_REASONS);
/** PROCESSING while a worker holds the lease; DECIDED once a decision is stored. */
export const requestStateEnum = pgEnum('request_state', ['PROCESSING', 'DECIDED']);
/** CUSTOMER for real submissions; SEED for the demo history loaded at startup. */
export const requestSourceEnum = pgEnum('request_source', ['CUSTOMER', 'SEED']);
export const policyOutcomeEnum = pgEnum('policy_outcome', POLICY_OUTCOMES);
export const lineStatusEnum = pgEnum('line_status', ['REFUNDED', 'NOT_REFUNDED', 'UNDER_REVIEW']);
export const decisionStatusEnum = pgEnum('decision_status', ['APPROVED', 'DENIED', 'ESCALATED']);
export const messageSourceEnum = pgEnum('message_source', ['AI', 'TEMPLATE']);
export const resolutionOutcomeEnum = pgEnum('resolution_outcome', ['APPROVED', 'PARTIALLY_APPROVED', 'DENIED']);
export type ResolutionOutcome = (typeof resolutionOutcomeEnum.enumValues)[number];
export const auditActorEnum = pgEnum('audit_actor', ['SYSTEM', 'AI', 'ADMIN', 'CUSTOMER']);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // Stored lower-cased so lookups and uniqueness are case-insensitive.
    email: text('email').notNull().unique(),
    // Salted scrypt hash (see auth/passwords.ts). Null: the customer cannot sign in.
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('customers_email_lowercase', sql`${t.email} = lower(${t.email})`)],
);

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
    // Target for refund_request_lines' (order_item_id, order_id) foreign key: a request line
    // can only name an item from the request's own order.
    unique('order_items_id_order_id_unique').on(t.id, t.orderId),
    check('order_items_price_non_negative', sql`${t.unitPricePaidMinor} >= 0`),
    check('order_items_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

/**
 * Every refund policy that has ever been loaded. Decisions reference the version
 * they were made under, so changing the policy never rewrites history.
 */
export const policyVersions = pgTable('policy_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  // One label per rule set: re-using a label with different content is rejected at startup.
  version: text('version').notNull().unique(),
  // SHA-256 of the parsed policy, so identical content is recognised across restarts.
  contentHash: text('content_hash').notNull().unique(),
  content: jsonb('content').$type<PolicyDocument>().notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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

export const conversationStateEnum = pgEnum('conversation_state', ['ACTIVE', 'SUBMITTED', 'CLOSED']);
export const conversationModeEnum = pgEnum('conversation_mode', ['AI', 'MANUAL']);
export const messageRoleEnum = pgEnum('message_role', ['CUSTOMER', 'ASSISTANT']);
export const aiCallKindEnum = pgEnum('ai_call_kind', ['CHAT_TURN', 'DECISION_REPLY', 'FOLLOW_UP', 'ADMIN_SUMMARY']);
export const aiCallOutcomeEnum = pgEnum('ai_call_outcome', ['OK', 'INVALID', 'TIMEOUT', 'ERROR', 'SKIPPED']);

export interface ConversationFlags {
  injectionAttempt: boolean;
  mentionsOtherCustomerOrder: boolean;
  abusive: boolean;
  offTopic: boolean;
}

export const NO_FLAGS: ConversationFlags = { injectionAttempt: false, mentionsOtherCustomerOrder: false, abusive: false, offTopic: false };

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    state: conversationStateEnum('state').notNull().default('ACTIVE'),
    mode: conversationModeEnum('mode').notNull(),
    // Why the chat switched to the claim form: AI_DISABLED, AI_FAILED or TURN_LIMIT.
    handoverReason: text('handover_reason'),
    turnCount: integer('turn_count').notNull().default(0),
    failedTurns: integer('failed_turns').notNull().default(0),
    // Verified claim proposal shown to the customer (see ProposalView).
    latestProposal: jsonb('latest_proposal'),
    discussedItemIds: uuid('discussed_item_ids').array().notNull().default(sql`'{}'::uuid[]`),
    // OR-accumulated over the conversation's lifetime; never cleared.
    flags: jsonb('flags').$type<ConversationFlags>().notNull().default(NO_FLAGS),
    // Set while a customer message is being answered; prevents concurrent turns.
    pendingSince: timestamp('pending_since', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('conversations_customer_created_idx').on(t.customerId, t.createdAt),
    check('conversations_counts_non_negative', sql`${t.turnCount} >= 0 AND ${t.failedTurns} >= 0`),
    check('conversations_handover_reason', sql`${t.handoverReason} IS NULL OR ${t.handoverReason} IN ('AI_DISABLED', 'AI_FAILED', 'TURN_LIMIT')`),
    check('conversations_manual_has_reason', sql`(${t.mode} = 'MANUAL') = (${t.handoverReason} IS NOT NULL)`),
  ],
);

export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'restrict' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    // False for chip taps and item selections, which are not usable as evidence.
    typed: boolean('typed').notNull().default(false),
    clientMessageId: uuid('client_message_id'),
    // Customer: the selection made. Assistant: quick replies, proposal and the message it answers.
    structured: jsonb('structured'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('conversation_messages_client_message_unique').on(t.conversationId, t.clientMessageId),
    index('conversation_messages_conversation_created_idx').on(t.conversationId, t.createdAt),
    check('conversation_messages_content_length', sql`char_length(${t.content}) BETWEEN 1 AND 1000`),
  ],
);

/** Metadata for every model call. Prompts and raw responses are not stored. */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'restrict' }),
    requestId: uuid('request_id').references(() => refundRequests.id, { onDelete: 'restrict' }),
    kind: aiCallKindEnum('kind').notNull(),
    provider: text('provider'),
    model: text('model'),
    outcome: aiCallOutcomeEnum('outcome').notNull(),
    attempts: integer('attempts').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    validatedOutput: jsonb('validated_output'),
    failureReason: text('failure_reason'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_calls_conversation_idx').on(t.conversationId), index('ai_calls_request_idx').on(t.requestId)],
);

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

/** The automated decision: exactly one per request, never edited (a human resolution is separate). */
export const decisions = pgTable(
  'decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .unique()
      .references(() => refundRequests.id, { onDelete: 'restrict' }),
    status: decisionStatusEnum('status').notNull(),
    approvedAmountMinor: integer('approved_amount_minor').notNull().default(0),
    policyVersionId: uuid('policy_version_id')
      .notNull()
      .references(() => policyVersions.id, { onDelete: 'restrict' }),
    // Null only when processing failed repeatedly and the request went to a person unevaluated.
    ruleTrace: jsonb('rule_trace').$type<RequestEvaluation>(),
    gateResult: jsonb('gate_result'),
    escalationReasons: text('escalation_reasons').array().notNull().default(sql`'{}'::text[]`),
    customerMessage: text('customer_message').notNull(),
    messageSource: messageSourceEnum('message_source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('decisions_amount_non_negative', sql`${t.approvedAmountMinor} >= 0`),
    // Only an approval carries money.
    check('decisions_amount_only_when_approved', sql`${t.status} = 'APPROVED' OR ${t.approvedAmountMinor} = 0`),
    check('decisions_escalation_has_reasons', sql`${t.status} <> 'ESCALATED' OR cardinality(${t.escalationReasons}) > 0`),
    // Every decision has a rule trace, except a system-failure escalation (the rules never ran).
    check(
      'decisions_trace_or_system_failure',
      sql`${t.ruleTrace} IS NOT NULL OR (${t.status} = 'ESCALATED' AND 'SYSTEM_PROCESSING_FAILURE' = ANY(${t.escalationReasons}))`,
    ),
  ],
);

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
    // Filled from the current HTTP request or sweeper pass (see common/correlation.ts).
    correlationId: text('correlation_id').$defaultFn(() => correlationId() ?? sql`NULL`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_events_request_created_idx').on(t.requestId, t.createdAt)],
);
