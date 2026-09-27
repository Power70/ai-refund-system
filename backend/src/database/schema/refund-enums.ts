import { pgEnum } from 'drizzle-orm/pg-core';
import { POLICY_OUTCOMES } from '../../policy/policy.schema.js';
import { REFUND_REASONS } from '../../policy/refund-reasons.js';

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
export const auditActorEnum = pgEnum('audit_actor', ['SYSTEM', 'AI', 'ADMIN', 'CUSTOMER']);
