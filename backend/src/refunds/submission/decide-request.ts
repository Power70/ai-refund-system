import { and, eq } from 'drizzle-orm';
import { applySafetyGate } from '../../decision/apply-safety-gate.js';
import type { Database } from '../../database/database.types.js';
import { auditEvents, decisions, refundRequestLines, refundRequests } from '../../database/schema/index.js';
import { evaluateRequest } from '../../policy/evaluate-request.js';
import { findPolicyById } from '../../policy/registry/find-policy-by-id.js';
import { buildRequestFacts } from '../facts/build-request-facts.js';
import { finalLineStatuses } from '../final-line-statuses.js';
import { templateCustomerMessage } from '../messages/template-customer-message.js';
import { assessmentForRequest } from './assessment-for-request.js';

export interface DecideOptions {
  minConfidence: number;
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
    // Set from the customer's conversation history once the AI conversation exists.
    priorFlaggedConversation: false,
    minConfidence: options.minConfidence,
  });
  const statuses = finalLineStatuses(evaluation, gate.status);
  const approvedAmountMinor = gate.status === 'APPROVED' ? evaluation.approvedAmountMinor : 0;
  const customerMessage = templateCustomerMessage(gate.status, evaluation.lines, policy.document.reviewEtaBusinessDays);
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
      customerMessage,
      messageSource: 'TEMPLATE',
      createdAt: now,
    });
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
      { requestId, type: 'DECISION_RECORDED', actor: 'SYSTEM', data: { status: gate.status, approvedAmountMinor, messageSource: 'TEMPLATE' }, createdAt: now },
    ]);
    return true;
  });
}
