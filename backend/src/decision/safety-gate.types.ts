import type { PolicyStatus } from '../policy/policy-evaluation.types.js';
import type { RefundReason } from '../policy/refund-reasons.js';

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
