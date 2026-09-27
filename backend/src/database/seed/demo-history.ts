import type { DemoHistoryEntry } from './demo-history.types.js';

/**
 * Earlier refund requests that some scenarios depend on. Each one is decided by the real
 * fact builder and policy engine when first seeded, so the history is consistent with the rules.
 * Listed strictly oldest first: later entries see earlier ones in their history.
 */
export const DEMO_HISTORY: readonly DemoHistoryEntry[] = [
  // #9 Ifeoma: four requests in the last 30 days, each fine on its own.
  { publicId: 'rr_9ynws0pw0001', customerEmail: 'ifeoma.nwosu@example.com', orderNumber: 'WN-9MA3CJ', daysAgo: 20, reason: 'DAMAGED', lines: [{ sku: 'PILLOW-MEM-STD', quantity: 1 }], expected: 'APPROVED' },
  { publicId: 'rr_9ynws0pw0002', customerEmail: 'ifeoma.nwosu@example.com', orderNumber: 'WN-9MA3CJ', daysAgo: 16, reason: 'DAMAGED', lines: [{ sku: 'PILLOW-MEM-STD', quantity: 1 }], expected: 'APPROVED' },
  { publicId: 'rr_9ynws0tw0003', customerEmail: 'ifeoma.nwosu@example.com', orderNumber: 'WN-1YD4GU', daysAgo: 12, reason: 'CHANGED_MIND', lines: [{ sku: 'TOWEL-BTH-SET', quantity: 1 }], expected: 'APPROVED' },
  // #8 Hassan: an unclear request went to a person, who said no.
  {
    publicId: 'rr_8hssn0hdph01', customerEmail: 'hassan.bello@example.com', orderNumber: 'WN-Z2T5HM', daysAgo: 9, reason: 'OTHER',
    lines: [{ sku: 'HEADPH-OVR-BLK', quantity: 1 }], expected: 'ESCALATED',
    resolution: { approveSkus: [], note: 'Customer finds the headphones too quiet; they work as designed, so this is not a defect.', daysAfter: 1 },
  },
  { publicId: 'rr_9ynws0pw0004', customerEmail: 'ifeoma.nwosu@example.com', orderNumber: 'WN-9MA3CJ', daysAgo: 8, reason: 'DAMAGED', lines: [{ sku: 'PILLOW-MEM-STD', quantity: 1 }], expected: 'APPROVED' },
  // #15 Obi: the kettle has been fully refunded.
  { publicId: 'rr_15bkett00001', customerEmail: 'obi.chukwu@example.com', orderNumber: 'WN-H9F3LX', daysAgo: 7, reason: 'DAMAGED', lines: [{ sku: 'KETTLE-ELC-1L', quantity: 1 }], expected: 'APPROVED' },
  // #6 Femi: $300 chair already refunded on the order the $280 mat is from.
  { publicId: 'rr_6fem0chr0001', customerEmail: 'femi.johnson@example.com', orderNumber: 'WN-8NF4QA', daysAgo: 6, reason: 'DAMAGED', lines: [{ sku: 'CHAIR-OFF-ERG', quantity: 1 }], expected: 'APPROVED' },
];
