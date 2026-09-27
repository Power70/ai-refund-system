import type { ClaimAssessment } from '../../decision/safety-gate.types.js';
import type { refundRequests } from '../../database/schema/index.js';

type RefundRequestRow = typeof refundRequests.$inferSelect;

/**
 * How the claim was assessed, derived only from what is stored with the request, so a retry
 * or the sweeper decides it exactly as the original attempt would have.
 * Until the AI conversation exists every claim is manual (no stored AI proposal).
 */
export function assessmentForRequest(request: RefundRequestRow): ClaimAssessment {
  if (request.aiProposal === null) return { kind: 'MANUAL' };
  // The AI conversation step will store its proposal here and map it to { kind: 'AI', ... }.
  return { kind: 'AI_UNAVAILABLE' };
}
