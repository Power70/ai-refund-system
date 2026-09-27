import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { customers } from './customers.table.js';
import { refundRequests } from './refund-requests.table.js';

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
