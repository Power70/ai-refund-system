import { firstNameOf } from '../common/format.js';
import type { ProposalRecord } from '../conversations/chat-turn.js';
import type { ConversationFlags, refundRequestLines, refundRequests } from '../database/schema.js';
import { evaluateRequest, type PolicyStatus, type RequestEvaluation } from '../policy/policy-engine.js';
import type { RefundReason } from '../policy/policy-schema.js';
import type { RegisteredPolicy } from '../policy/policy.service.js';
import type { DecisionBrief } from './customer-messages.service.js';
import type { RequestFacts } from './request-facts.service.js';

/** How the claim was understood before the customer confirmed it. */
export type ClaimAssessment =
  /** The customer filled in the claim themselves. */
  | { kind: 'MANUAL' }
  /** The AI was down, timed out or returned something invalid. */
  | { kind: 'AI_UNAVAILABLE' }
  | {
      kind: 'AI';
      proposedReason: RefundReason;
      /** Items that came up in the conversation (proposals, chips, orders panel). */
      discussedItemIds: readonly string[];
      /** Self-reported by the model: an extra condition only, never the sole one. */
      confidence: number;
      flags: { injectionSuspected: boolean; otherCustomerOrderMentioned: boolean; abusive: boolean };
    };

export interface GateInput {
  policyStatus: PolicyStatus;
  confirmedReason: RefundReason;
  confirmedItemIds: readonly string[];
  assessment: ClaimAssessment;
  /** This customer had a flagged conversation in the last 30 days. */
  priorFlaggedConversation: boolean;
  minConfidence: number;
}

export type GateReason =
  | 'NO_AI_ASSESSMENT'
  | 'AI_UNAVAILABLE'
  | 'REASON_OVERRIDDEN'
  | 'ITEM_NOT_DISCUSSED'
  | 'INJECTION_SUSPECTED'
  | 'OTHER_CUSTOMER_ORDER_MENTIONED'
  | 'ABUSIVE'
  | 'PRIOR_FLAGS'
  | 'LOW_CONFIDENCE';

export interface GateResult {
  status: PolicyStatus;
  /** Why an approval was held back for a person (empty when nothing changed). */
  reasons: GateReason[];
}

/**
 * The last check before an automatic approval. It can only turn APPROVED into ESCALATED:
 * DENIED and ESCALATED pass through untouched, and nothing here can ever produce an approval.
 * An approval stands only if every check passes; otherwise a person decides.
 */
export function applySafetyGate(input: GateInput): GateResult {
  if (input.policyStatus !== 'APPROVED') return { status: input.policyStatus, reasons: [] };

  const reasons: GateReason[] = [];
  const { assessment } = input;

  if (assessment.kind === 'MANUAL') reasons.push('NO_AI_ASSESSMENT');
  if (assessment.kind === 'AI_UNAVAILABLE') reasons.push('AI_UNAVAILABLE');
  if (assessment.kind === 'AI') {
    if (assessment.proposedReason !== input.confirmedReason) reasons.push('REASON_OVERRIDDEN');
    if (input.confirmedItemIds.some((id) => !assessment.discussedItemIds.includes(id))) reasons.push('ITEM_NOT_DISCUSSED');
    if (assessment.flags.injectionSuspected) reasons.push('INJECTION_SUSPECTED');
    if (assessment.flags.otherCustomerOrderMentioned) reasons.push('OTHER_CUSTOMER_ORDER_MENTIONED');
    if (assessment.flags.abusive) reasons.push('ABUSIVE');
    if (!(assessment.confidence >= input.minConfidence)) reasons.push('LOW_CONFIDENCE');
  }
  if (input.priorFlaggedConversation) reasons.push('PRIOR_FLAGS');

  return reasons.length > 0 ? { status: 'ESCALATED', reasons } : { status: 'APPROVED', reasons: [] };
}

export type HandoverReason = 'AI_DISABLED' | 'AI_FAILED' | 'TURN_LIMIT';

/** Conversation state captured when the claim is submitted. */
export interface ClaimContext {
  conversationId: string | null;
  handoverReason: HandoverReason | null;
  discussedItemIds: string[];
  flags: ConversationFlags | null;
  /** Another conversation of this customer in the previous 30 days was flagged. */
  priorFlaggedConversation: boolean;
}

/**
 * Derives the gate's view of the claim from the request row only, so the first attempt,
 * a retry and the sweeper reach the same decision.
 */
export function assessmentForRequest(request: Pick<typeof refundRequests.$inferSelect, 'claimContext' | 'aiProposal'>): ClaimAssessment {
  const context = request.claimContext;
  const proposal = request.aiProposal as ProposalRecord | null;
  if (context?.handoverReason === 'AI_DISABLED' || context?.handoverReason === 'AI_FAILED') return { kind: 'AI_UNAVAILABLE' };
  if (!context || !proposal) return { kind: 'MANUAL' };

  const flags = context.flags;
  return {
    kind: 'AI',
    proposedReason: proposal.reason,
    discussedItemIds: context.discussedItemIds,
    confidence: proposal.confidence,
    flags: {
      injectionSuspected: flags?.injectionAttempt ?? false,
      otherCustomerOrderMentioned: flags?.mentionsOtherCustomerOrder ?? false,
      abusive: flags?.abusive ?? false,
    },
  };
}

export type FinalLineStatus = 'REFUNDED' | 'NOT_REFUNDED' | 'UNDER_REVIEW';

/**
 * What each line becomes once the final decision is stored:
 *  APPROVED  → ALLOW lines refunded, DENY lines not refunded;
 *  DENIED    → nothing refunded;
 *  ESCALATED → every line waits for a person (and stays reserved).
 * `finalStatus` is the status after the safety gate, which may hold back a policy approval.
 */
export function finalLineStatuses(
  evaluation: RequestEvaluation,
  finalStatus: PolicyStatus = evaluation.status,
): Map<string, FinalLineStatus> {
  return new Map(
    evaluation.lines.map((line) => {
      if (finalStatus === 'ESCALATED') return [line.lineId, 'UNDER_REVIEW'] as const;
      if (finalStatus === 'APPROVED' && line.outcome === 'ALLOW') return [line.lineId, 'REFUNDED'] as const;
      return [line.lineId, 'NOT_REFUNDED'] as const;
    }),
  );
}

export interface DecisionInput {
  request: typeof refundRequests.$inferSelect;
  lines: readonly Pick<typeof refundRequestLines.$inferSelect, 'orderItemId' | 'quantity'>[];
  policy: RegisteredPolicy;
  facts: RequestFacts;
  customerName: string;
  currency: string;
  itemNames: ReadonlyMap<string, string>;
  minConfidence: number;
}

export interface DecisionPlan {
  evaluation: RequestEvaluation;
  assessment: ClaimAssessment;
  gate: GateResult;
  statuses: Map<string, FinalLineStatus>;
  approvedAmountMinor: number;
  /** What the customer message is written from. */
  brief: DecisionBrief;
}

/**
 * Policy engine, then safety gate, from stored inputs only: the first attempt, a retry and
 * the sweeper reach the same decision for the same request.
 */
export function planDecision(input: DecisionInput): DecisionPlan {
  const { request, lines, policy } = input;
  const evaluation = evaluateRequest(policy.document, input.facts.lines, input.facts.history);
  const assessment = assessmentForRequest(request);
  const gate = applySafetyGate({
    policyStatus: evaluation.status,
    confirmedReason: request.reasonConfirmed,
    confirmedItemIds: lines.map((l) => l.orderItemId),
    assessment,
    priorFlaggedConversation: request.claimContext?.priorFlaggedConversation ?? false,
    minConfidence: input.minConfidence,
  });
  const statuses = finalLineStatuses(evaluation, gate.status);
  const approvedAmountMinor = gate.status === 'APPROVED' ? evaluation.approvedAmountMinor : 0;
  const quantityOf = new Map(lines.map((l) => [l.orderItemId, l.quantity]));

  const brief: DecisionBrief = {
    requestId: request.publicId,
    status: gate.status,
    firstName: firstNameOf(input.customerName),
    currency: input.currency,
    approvedAmountMinor,
    reviewEtaBusinessDays: policy.document.reviewEtaBusinessDays,
    items: evaluation.lines.map((line) => {
      const status = statuses.get(line.lineId);
      return {
        name: input.itemNames.get(line.lineId) ?? 'item',
        quantity: quantityOf.get(line.lineId) ?? 1,
        refunded: status === 'UNDER_REVIEW' ? null : status === 'REFUNDED',
        publicReason: gate.status === 'ESCALATED' ? null : line.publicReason,
      };
    }),
    reviewedBySupport: false,
  };
  return { evaluation, assessment, gate, statuses, approvedAmountMinor, brief };
}
