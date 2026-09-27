/** Reasons a customer can give. Shared by the policy, the AI intake and the UI. */
export const REFUND_REASONS = [
  'DAMAGED',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'CHANGED_MIND',
  'OTHER',
] as const;

export type RefundReason = (typeof REFUND_REASONS)[number];
