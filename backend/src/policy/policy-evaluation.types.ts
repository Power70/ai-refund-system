import type { FactValues } from './fact-vocabulary.js';
import type { PolicyOutcome } from './policy.schema.js';

/** One rule's result, kept for the audit trail whether it matched or not. */
export interface RuleTraceEntry {
  ruleId: string;
  outcome: PolicyOutcome;
  matched: boolean;
}

export interface RuleSetResult {
  trace: RuleTraceEntry[];
  /** Winning outcome among matched rules, or null when nothing matched. */
  outcome: PolicyOutcome | null;
  /** First matched rule (in file order) carrying the winning outcome. */
  decidingRuleId: string | null;
}

export interface LineInput {
  lineId: string;
  /** Refund amount for this line in minor units, computed from the DB. */
  amountMinor: number;
  facts: FactValues;
}

export interface LineEvaluation extends LineInput {
  outcome: PolicyOutcome;
  /** null when no rule matched and the policy default applied. */
  decidingRuleId: string | null;
  publicReason: string;
  trace: RuleTraceEntry[];
}

/** Request-level facts supplied by the caller; the engine derives the rest. */
export interface RequestHistoryFacts {
  'order.refundedOrPendingMinor': number;
  'customer.requestsLast30Days': number;
}

export type PolicyStatus = 'APPROVED' | 'DENIED' | 'ESCALATED';

export interface RequestEvaluation {
  policyVersion: string;
  /** APPROVED here still has to pass the AI safety gate before it is final. */
  status: PolicyStatus;
  /** Sum of ALLOW lines when APPROVED, otherwise 0. */
  approvedAmountMinor: number;
  lines: LineEvaluation[];
  /** False when every line was denied, so request rules were never consulted. */
  requestRulesEvaluated: boolean;
  requestFacts: FactValues | null;
  requestTrace: RuleTraceEntry[];
  requestDecidingRuleId: string | null;
  /** Rule ids (or "DEFAULT") that sent the request to a person. */
  escalationRuleIds: string[];
}
