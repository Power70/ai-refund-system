import type { FactName } from './fact-vocabulary.js';
import type { RefundReason } from './refund-reasons.js';

/** Plain-English wording used when the policy is rendered for people. */
export const BOOLEAN_FACT_PHRASES: Partial<Record<FactName, { true: string; false: string }>> = {
  'item.delivered': { true: 'the item has been delivered', false: 'the item has not been delivered' },
  'item.finalSale': { true: 'the item is final sale', false: 'the item is not final sale' },
  'item.priorDeniedRequest': {
    true: 'an earlier request for this item was denied',
    false: 'no earlier request for this item was denied',
  },
};

export const FACT_LABELS: Record<FactName, string> = {
  'item.delivered': 'delivery status',
  'item.daysSinceDelivery': 'days since delivery',
  'item.finalSale': 'final-sale status',
  'item.category': 'the item category',
  'item.priorDeniedRequest': 'earlier denied request',
  'claim.reason': 'the reason',
  'request.candidateAmountMinor': 'the amount qualifying in this request',
  'order.refundedOrPendingMinor': 'the amount already refunded or pending on the order',
  'request.cumulativeOrderRefundMinor': 'the order\'s total refunds (including this request)',
  'customer.requestsLast30Days': "the number of the customer's refund requests in the last 30 days",
};

/** Facts holding money in minor units; rendered as currency. */
export const MONEY_FACTS: ReadonlySet<FactName> = new Set([
  'request.candidateAmountMinor',
  'order.refundedOrPendingMinor',
  'request.cumulativeOrderRefundMinor',
]);

export const REASON_LABELS: Record<RefundReason, string> = {
  DAMAGED: 'Damaged',
  WRONG_ITEM: 'Wrong item',
  NOT_AS_DESCRIBED: 'Not as described',
  CHANGED_MIND: 'Changed mind',
  OTHER: 'Other',
};
