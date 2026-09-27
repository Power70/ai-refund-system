import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { RequestEvaluation } from '../../policy/policy-evaluation.types.js';
import { policyVersions } from './policy-versions.table.js';
import { decisionStatusEnum, messageSourceEnum } from './refund-enums.js';
import { refundRequests } from './refund-requests.table.js';

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
    ruleTrace: jsonb('rule_trace').$type<RequestEvaluation>().notNull(),
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
  ],
);
