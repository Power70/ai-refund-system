import type { RefundReason } from '../../policy/policy-schema.js';

export interface DemoItem {
  sku: string;
  name: string;
  category: string;
  unitPricePaidMinor: number;
  quantity: number;
  finalSale?: boolean;
}

export interface DemoOrder {
  orderNumber: string;
  /** Whole days since delivery at seed time; null = not delivered yet. */
  deliveredDaysAgo: number | null;
  items: DemoItem[];
}

export interface DemoCustomer {
  name: string;
  /** Email plus-alias number: the seed signs this customer up as <local>+<alias>@<domain> of SEED_CUSTOMER_EMAIL. */
  alias: number;
  /** Which demo scenario this customer exists for (documentation only, not stored). */
  scenario: string;
  orders: DemoOrder[];
}

export interface DemoHistoryEntry {
  /** Fixed so re-seeding recognises it; same format as real request ids. */
  publicId: string;
  customerAlias: number;
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

/** `nwisuanu@gmail.com` + 3 → `nwisuanu+3@gmail.com`. The base comes from configuration, never from code. */
export function demoEmail(base: string, alias: number): string {
  const at = base.lastIndexOf('@');
  return `${base.slice(0, at)}+${alias}${base.slice(at)}`.toLowerCase();
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SHIPPING_DAYS = 3;
const UNDELIVERED_PLACED_DAYS_AGO = 2;

/**
 * Turns "delivered N days ago" into concrete timestamps relative to `now`.
 * Delivery is placed one hour past the N-day mark, so the order keeps reading as
 * exactly N whole days old for the next 23 hours (the demo stays stable during a review).
 */
export function demoOrderDates(deliveredDaysAgo: number | null, now: Date): { placedAt: Date; deliveredAt: Date | null } {
  if (deliveredDaysAgo === null) {
    return { placedAt: new Date(now.getTime() - UNDELIVERED_PLACED_DAYS_AGO * DAY_MS), deliveredAt: null };
  }
  const deliveredAt = new Date(now.getTime() - deliveredDaysAgo * DAY_MS - HOUR_MS);
  return { placedAt: new Date(deliveredAt.getTime() - SHIPPING_DAYS * DAY_MS), deliveredAt };
}

/**
 * The demo CRM: 15 customers, each with 1–3 orders. Order numbers are fixed (so the
 * README can list them) but non-sequential. Dates are relative to seeding time, so the
 * scenarios behave the same whenever the stack is started.
 * Prices are what the customer actually paid, in cents.
 */
export const DEMO_CATALOG: readonly DemoCustomer[] = [
  {
    name: 'Ada Okafor', alias: 1, scenario: '#1 damaged shirt within 30 days → approved',
    orders: [
      { orderNumber: 'WN-7K3P9Q', deliveredDaysAgo: 5, items: [{ sku: 'SHIRT-OXF-BLU-M', name: 'Oxford shirt, blue', category: 'apparel', unitPricePaidMinor: 4999, quantity: 1 }] },
      { orderNumber: 'WN-2HX8LD', deliveredDaysAgo: 64, items: [{ sku: 'MUG-CER-WHT', name: 'Ceramic mug, white', category: 'home', unitPricePaidMinor: 1200, quantity: 2 }] },
    ],
  },
  {
    name: 'Ben Carter', alias: 2, scenario: '#2 damaged item after 45 days → denied (window)',
    orders: [
      { orderNumber: 'WN-Q4M1ZT', deliveredDaysAgo: 45, items: [{ sku: 'LAMP-DSK-BLK', name: 'Desk lamp, black', category: 'home', unitPricePaidMinor: 3500, quantity: 1 }] },
    ],
  },
  {
    name: 'Chika Eze', alias: 3, scenario: '#3 final-sale belt, changed mind → denied (final sale)',
    orders: [
      { orderNumber: 'WN-9TB6RW', deliveredDaysAgo: 10, items: [{ sku: 'BELT-LTH-BRN', name: 'Leather belt, brown (clearance)', category: 'accessories', unitPricePaidMinor: 2500, quantity: 1, finalSale: true }] },
      { orderNumber: 'WN-5VJ2NC', deliveredDaysAgo: 120, items: [{ sku: 'SCARF-WOL-GRY', name: 'Wool scarf, grey', category: 'accessories', unitPricePaidMinor: 2800, quantity: 1 }] },
    ],
  },
  {
    name: 'Daniel Mensah', alias: 4, scenario: '#4 final-sale item arrived damaged → escalated (conflict)',
    orders: [
      { orderNumber: 'WN-X8D3KF', deliveredDaysAgo: 3, items: [{ sku: 'JKT-DNM-IND-L', name: 'Denim jacket (final sale)', category: 'apparel', unitPricePaidMinor: 6000, quantity: 1, finalSale: true }] },
    ],
  },
  {
    name: 'Efe Adebayo', alias: 5, scenario: '#5 wrong laptop, $749 → escalated (over $500)',
    orders: [
      { orderNumber: 'WN-L6W9PH', deliveredDaysAgo: 4, items: [{ sku: 'LAPTOP-14-512', name: 'Laptop 14", 512 GB', category: 'electronics', unitPricePaidMinor: 74900, quantity: 1 }] },
      { orderNumber: 'WN-3RC7YB', deliveredDaysAgo: 30, items: [{ sku: 'SLEEVE-LAP-14', name: 'Laptop sleeve 14"', category: 'accessories', unitPricePaidMinor: 2200, quantity: 1 }] },
    ],
  },
  {
    name: 'Femi Johnson', alias: 6, scenario: '#6 $280 item after $300 refunded on the same order → escalated (cumulative)',
    orders: [
      {
        orderNumber: 'WN-8NF4QA', deliveredDaysAgo: 8,
        items: [
          { sku: 'CHAIR-OFF-ERG', name: 'Ergonomic office chair', category: 'furniture', unitPricePaidMinor: 30000, quantity: 1 },
          { sku: 'DESK-MAT-XL', name: 'Standing desk mat, XL', category: 'furniture', unitPricePaidMinor: 28000, quantity: 1 },
        ],
      },
    ],
  },
  {
    name: 'Grace Lee', alias: 7, scenario: '#7 two shirts, changed mind on one → AI asks which; approved',
    orders: [
      {
        orderNumber: 'WN-4GK1VS', deliveredDaysAgo: 10,
        items: [
          { sku: 'SHIRT-LIN-BLU-S', name: 'Linen shirt, blue', category: 'apparel', unitPricePaidMinor: 8000, quantity: 1 },
          { sku: 'SHIRT-LIN-WHT-S', name: 'Linen shirt, white', category: 'apparel', unitPricePaidMinor: 6000, quantity: 1 },
        ],
      },
    ],
  },
  {
    name: 'Hassan Bello', alias: 8, scenario: '#8 item denied before, resubmitted with a new reason → escalated',
    orders: [
      { orderNumber: 'WN-Z2T5HM', deliveredDaysAgo: 12, items: [{ sku: 'HEADPH-OVR-BLK', name: 'Over-ear headphones', category: 'electronics', unitPricePaidMinor: 4000, quantity: 1 }] },
    ],
  },
  {
    name: 'Ifeoma Nwosu', alias: 9, scenario: '#9 four requests in the last 30 days → escalated (frequency)',
    orders: [
      { orderNumber: 'WN-6PQ8XE', deliveredDaysAgo: 6, items: [{ sku: 'CANDLE-SOY-VAN', name: 'Soy candle, vanilla', category: 'home', unitPricePaidMinor: 3000, quantity: 1 }] },
      { orderNumber: 'WN-1YD4GU', deliveredDaysAgo: 15, items: [{ sku: 'TOWEL-BTH-SET', name: 'Bath towel set', category: 'home', unitPricePaidMinor: 4500, quantity: 1 }] },
      { orderNumber: 'WN-9MA3CJ', deliveredDaysAgo: 22, items: [{ sku: 'PILLOW-MEM-STD', name: 'Memory foam pillow', category: 'home', unitPricePaidMinor: 3800, quantity: 3 }] },
    ],
  },
  {
    name: 'Jide Afolabi', alias: 10, scenario: '#10 order not delivered yet → escalated',
    orders: [
      { orderNumber: 'WN-K5R2BW', deliveredDaysAgo: null, items: [{ sku: 'SPEAKER-BT-MINI', name: 'Bluetooth speaker, mini', category: 'electronics', unitPricePaidMinor: 5000, quantity: 1 }] },
    ],
  },
  {
    name: 'Kemi Adeyemi', alias: 11, scenario: '#11 shirt + final-sale belt, changed mind → shirt refunded, belt not',
    orders: [
      {
        orderNumber: 'WN-3VH9TL', deliveredDaysAgo: 7,
        items: [
          { sku: 'SHIRT-POL-GRN-M', name: 'Polo shirt, green', category: 'apparel', unitPricePaidMinor: 4500, quantity: 1 },
          { sku: 'BELT-CNV-NVY', name: 'Canvas belt, navy (clearance)', category: 'accessories', unitPricePaidMinor: 2500, quantity: 1, finalSale: true },
        ],
      },
    ],
  },
  {
    name: 'Lara Smith', alias: 12, scenario: '#12 eligible item, injection attempt in chat → escalated',
    orders: [
      { orderNumber: 'WN-7XW2QD', deliveredDaysAgo: 5, items: [{ sku: 'BOTTLE-STL-750', name: 'Steel water bottle, 750 ml', category: 'outdoor', unitPricePaidMinor: 5500, quantity: 1 }] },
    ],
  },
  {
    name: 'Musa Ibrahim', alias: 13, scenario: '#13 AI reads "changed mind", customer edits to "damaged" → escalated',
    orders: [
      { orderNumber: 'WN-B4N6ZR', deliveredDaysAgo: 6, items: [{ sku: 'BAG-BPK-GRY', name: 'Backpack, grey', category: 'accessories', unitPricePaidMinor: 6500, quantity: 1 }] },
      { orderNumber: 'WN-5QE1MK', deliveredDaysAgo: 40, items: [{ sku: 'CAP-BSB-BLK', name: 'Baseball cap, black', category: 'accessories', unitPricePaidMinor: 1800, quantity: 1 }] },
    ],
  },
  {
    name: 'Ngozi Obi', alias: 14, scenario: '#14 exactly $500.00, damaged → approved (boundary)',
    orders: [
      { orderNumber: 'WN-2JC8WP', deliveredDaysAgo: 2, items: [{ sku: 'TABLET-10-128', name: 'Tablet 10", 128 GB', category: 'electronics', unitPricePaidMinor: 50000, quantity: 1 }] },
    ],
  },
  {
    name: 'Obi Chukwu', alias: 15, scenario: '#15 item already fully refunded → nothing left to refund',
    orders: [
      { orderNumber: 'WN-H9F3LX', deliveredDaysAgo: 9, items: [{ sku: 'KETTLE-ELC-1L', name: 'Electric kettle, 1 L', category: 'home', unitPricePaidMinor: 7000, quantity: 1 }] },
      { orderNumber: 'WN-6TZ5DN', deliveredDaysAgo: 3, items: [{ sku: 'TOASTER-2SL', name: 'Toaster, 2-slice', category: 'home', unitPricePaidMinor: 3900, quantity: 1 }] },
    ],
  },
];

/**
 * Earlier refund requests that some scenarios depend on. Each one is decided by the real
 * fact builder and policy engine when first seeded, so the history is consistent with the rules.
 * Listed strictly oldest first: later entries see earlier ones in their history.
 */
export const DEMO_HISTORY: readonly DemoHistoryEntry[] = [
  // #9 Ifeoma: four requests in the last 30 days, each fine on its own.
  { publicId: 'rr_9ynws0pw0001', customerAlias: 9, orderNumber: 'WN-9MA3CJ', daysAgo: 20, reason: 'DAMAGED', lines: [{ sku: 'PILLOW-MEM-STD', quantity: 1 }], expected: 'APPROVED' },
  { publicId: 'rr_9ynws0pw0002', customerAlias: 9, orderNumber: 'WN-9MA3CJ', daysAgo: 16, reason: 'DAMAGED', lines: [{ sku: 'PILLOW-MEM-STD', quantity: 1 }], expected: 'APPROVED' },
  { publicId: 'rr_9ynws0tw0003', customerAlias: 9, orderNumber: 'WN-1YD4GU', daysAgo: 12, reason: 'CHANGED_MIND', lines: [{ sku: 'TOWEL-BTH-SET', quantity: 1 }], expected: 'APPROVED' },
  // #8 Hassan: an unclear request went to a person, who said no.
  {
    publicId: 'rr_8hssn0hdph01', customerAlias: 8, orderNumber: 'WN-Z2T5HM', daysAgo: 9, reason: 'OTHER',
    lines: [{ sku: 'HEADPH-OVR-BLK', quantity: 1 }], expected: 'ESCALATED',
    resolution: { approveSkus: [], note: 'Customer finds the headphones too quiet; they work as designed, so this is not a defect.', daysAfter: 1 },
  },
  { publicId: 'rr_9ynws0pw0004', customerAlias: 9, orderNumber: 'WN-9MA3CJ', daysAgo: 8, reason: 'DAMAGED', lines: [{ sku: 'PILLOW-MEM-STD', quantity: 1 }], expected: 'APPROVED' },
  // #15 Obi: the kettle has been fully refunded.
  { publicId: 'rr_15bkett00001', customerAlias: 15, orderNumber: 'WN-H9F3LX', daysAgo: 7, reason: 'DAMAGED', lines: [{ sku: 'KETTLE-ELC-1L', quantity: 1 }], expected: 'APPROVED' },
  // #6 Femi: $300 chair already refunded on the order the $280 mat is from.
  { publicId: 'rr_6fem0chr0001', customerAlias: 6, orderNumber: 'WN-8NF4QA', daysAgo: 6, reason: 'DAMAGED', lines: [{ sku: 'CHAIR-OFF-ERG', quantity: 1 }], expected: 'APPROVED' },
];
