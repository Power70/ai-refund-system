/** Reasons a customer can give. Shared by the policy, the AI intake and the UI. */
export const REFUND_REASONS = [
  'DAMAGED',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'CHANGED_MIND',
  'OTHER',
] as const;

export type RefundReason = (typeof REFUND_REASONS)[number];

/** Customer-facing labels, used for quick replies and in the prompt. */
export const REASON_LABELS: Record<RefundReason, string> = {
  DAMAGED: 'It arrived damaged or defective',
  WRONG_ITEM: 'I received the wrong item',
  NOT_AS_DESCRIBED: "It's not as described",
  CHANGED_MIND: 'I changed my mind',
  OTHER: 'Something else',
};
