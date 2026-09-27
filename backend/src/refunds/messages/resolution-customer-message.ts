import { formatMoney } from '../../common/format-money.js';
import type { ResolutionOutcome } from '../../admin/resolution/derive-resolution.js';

export interface ResolvedItem {
  itemName: string;
  approve: boolean;
}

/**
 * What the customer sees after a person resolves their escalated request. It names the items
 * and the total, both taken from the stored resolution, and never quotes the reviewer's internal note.
 */
export function resolutionCustomerMessage(outcome: ResolutionOutcome, items: readonly ResolvedItem[], approvedAmountMinor: number, currency: string): string {
  const names = (approve: boolean) => items.filter((i) => i.approve === approve).map((i) => i.itemName).join(', ');
  switch (outcome) {
    case 'APPROVED':
      return `Our support team reviewed your request and approved your refund of ${formatMoney(approvedAmountMinor, currency)}.`;
    case 'PARTIALLY_APPROVED':
      return `Our support team reviewed your request and approved a refund of ${formatMoney(approvedAmountMinor, currency)} for: ${names(true)}. We couldn't approve a refund for: ${names(false)}.`;
    case 'DENIED':
      return "Our support team reviewed your request and wasn't able to approve a refund.";
  }
}
