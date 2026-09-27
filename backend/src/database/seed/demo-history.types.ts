import type { RefundReason } from '../../policy/refund-reasons.js';

export interface DemoHistoryEntry {
  /** Fixed so re-seeding recognises it; same format as real request ids. */
  publicId: string;
  customerEmail: string;
  orderNumber: string;
  /** When the request was made, in whole days before seeding. */
  daysAgo: number;
  reason: RefundReason;
  lines: { sku: string; quantity: number }[];
  /** A reviewer's decision on an escalated request: which SKUs they approved. */
  resolution?: { approveSkus: string[]; note: string; daysAfter: number };
  /** What the committed policy decides; checked by tests, never by the seed itself. */
  expected: 'APPROVED' | 'DENIED' | 'ESCALATED';
}
