import type { RefundReason } from '../../policy/refund-reasons.js';

export interface RequestedLine {
  orderItemId: string;
  quantity: number;
}

export interface RequestFactInput {
  customerId: string;
  orderId: string;
  reason: RefundReason;
  lines: readonly RequestedLine[];
  /** The moment the request is judged at (its submission time). */
  at: Date;
  /** The request being judged, excluded from its own history. */
  excludeRequestId?: string;
}
