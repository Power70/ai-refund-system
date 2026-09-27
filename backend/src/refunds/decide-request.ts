import { and, eq } from 'drizzle-orm';
import type { ProposalRecord } from '../conversations/chat-turn.js';
import type { Database } from '../database/database.js';
import { aiCalls, auditEvents, customers, decisions, orderItems, orders, refundRequestLines, refundRequests, type ConversationFlags } from '../database/schema.js';
import { evaluateRequest, type PolicyStatus, type RequestEvaluation } from '../policy/policy-engine.js';
import { findPolicyById } from '../policy/policy-registry.js';
import type { RefundReason } from '../policy/policy-schema.js';
import { buildRequestFacts } from './refund-facts.js';
import type { LlmService } from '../ai/llm.service.js';
import { decisionTemplate as writeTemplate, writeDecisionReply, type DecisionBrief } from './refund-messages.js';

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

type RefundRequestRow = typeof refundRequests.$inferSelect;

/**
 * Derives the gate's view of the claim from the request row only, so the first attempt,
 * a retry and the sweeper reach the same decision.
 */
export function assessmentForRequest(request: RefundRequestRow): ClaimAssessment {
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

export interface DecideOptions {
  minConfidence: number;
  /** Writes the customer message; without it (or with AI disabled) the template is used. */
  llm?: LlmService;
}

/**
 * Decides a reserved request: facts (as of submission) → policy engine → safety gate.
 * Everything comes from what is stored with the request (claim, policy version, AI assessment),
 * so the first attempt, a retry and the sweeper all reach the same decision.
 * Then transaction 2 stores the decision, but only while this worker still holds the lease;
 * if the lease was lost (e.g. it expired and another worker took over) nothing is written.
 * Returns false when the lease was lost.
 */
export async function decideRequest(db: Database, requestId: string, leaseOwner: string, options: DecideOptions): Promise<boolean> {
  const [request] = await db.select().from(refundRequests).where(eq(refundRequests.id, requestId));
  if (!request || request.state !== 'PROCESSING' || request.leaseOwner !== leaseOwner) return false;
  const lines = await db.select().from(refundRequestLines).where(eq(refundRequestLines.requestId, requestId));

  const policy = await findPolicyById(db, request.policyVersionId);
  const facts = await buildRequestFacts(db, {
    customerId: request.customerId,
    orderId: request.orderId,
    reason: request.reasonConfirmed,
    lines: lines.map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })),
    at: request.createdAt,
    excludeRequestId: request.id,
  });
  const evaluation = evaluateRequest(policy.document, facts.lines, facts.history);
  const assessment = assessmentForRequest(request);
  const gate = applySafetyGate({
    policyStatus: evaluation.status,
    confirmedReason: request.reasonConfirmed,
    confirmedItemIds: lines.map((l) => l.orderItemId),
    assessment,
    priorFlaggedConversation: request.claimContext?.priorFlaggedConversation ?? false,
    minConfidence: options.minConfidence,
  });
  const statuses = finalLineStatuses(evaluation, gate.status);
  const approvedAmountMinor = gate.status === 'APPROVED' ? evaluation.approvedAmountMinor : 0;
  const [who] = await db
    .select({ name: customers.name, currency: orders.currency })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.id, request.orderId));
  const names = new Map(
    (await db.select({ id: orderItems.id, name: orderItems.name }).from(orderItems).where(eq(orderItems.orderId, request.orderId))).map((i) => [i.id, i.name]),
  );
  const brief: DecisionBrief = {
    requestId: request.publicId,
    status: gate.status,
    firstName: who.name.split(' ')[0],
    currency: who.currency,
    approvedAmountMinor,
    reviewEtaBusinessDays: policy.document.reviewEtaBusinessDays,
    items: evaluation.lines.map((line) => {
      const status = statuses.get(line.lineId);
      return {
        name: names.get(line.lineId) ?? 'item',
        quantity: lines.find((l) => l.orderItemId === line.lineId)?.quantity ?? 1,
        refunded: status === 'UNDER_REVIEW' ? null : status === 'REFUNDED',
        publicReason: gate.status === 'ESCALATED' ? null : line.publicReason,
      };
    }),
    reviewedBySupport: false,
  };
  // Generated before transaction 2 so no transaction is held open during the model call.
  const reply = options.llm
    ? await writeDecisionReply(options.llm, brief)
    : { text: writeTemplate(brief), source: 'TEMPLATE' as const, call: null };
  const now = new Date();

  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(refundRequests)
      .set({ state: 'DECIDED', leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
      .where(and(eq(refundRequests.id, requestId), eq(refundRequests.state, 'PROCESSING'), eq(refundRequests.leaseOwner, leaseOwner)))
      .returning({ id: refundRequests.id });
    if (claimed.length === 0) return false;

    await tx.insert(decisions).values({
      requestId,
      status: gate.status,
      approvedAmountMinor,
      policyVersionId: policy.id,
      ruleTrace: evaluation,
      gateResult: { policyStatus: evaluation.status, ...gate, assessment: assessment.kind },
      escalationReasons: [...evaluation.escalationRuleIds, ...gate.reasons],
      customerMessage: reply.text,
      messageSource: reply.source,
      createdAt: now,
    });
    if (reply.call) await tx.insert(aiCalls).values({ ...reply.call, kind: 'DECISION_REPLY', requestId, conversationId: request.conversationId, createdAt: now });
    for (const line of evaluation.lines) {
      await tx
        .update(refundRequestLines)
        .set({ lineOutcome: line.outcome, decidingRuleId: line.decidingRuleId, finalLineStatus: statuses.get(line.lineId)! })
        .where(and(eq(refundRequestLines.requestId, requestId), eq(refundRequestLines.orderItemId, line.lineId)));
    }
    await tx.insert(auditEvents).values([
      {
        requestId,
        type: 'POLICY_EVALUATED',
        actor: 'SYSTEM',
        data: { policyVersion: policy.version, status: evaluation.status, escalationRuleIds: evaluation.escalationRuleIds, approvedAmountMinor: evaluation.approvedAmountMinor },
        createdAt: now,
      },
      { requestId, type: 'SAFETY_GATE_APPLIED', actor: 'SYSTEM', data: { status: gate.status, reasons: gate.reasons, assessment: assessment.kind }, createdAt: now },
      { requestId, type: 'DECISION_RECORDED', actor: 'SYSTEM', data: { status: gate.status, approvedAmountMinor, messageSource: reply.source }, createdAt: now },
    ]);
    return true;
  });
}
