import type { ConversationFlags } from '../../database/schema/conversations.table.js';
import type { refundRequests } from '../../database/schema/index.js';
import type { ClaimAssessment } from '../../decision/safety-gate.types.js';
import type { ProposalRecord } from '../../conversations/verify-turn.js';

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
