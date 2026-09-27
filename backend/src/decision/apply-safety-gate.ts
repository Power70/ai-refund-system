import type { GateInput, GateReason, GateResult } from './safety-gate.types.js';

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
