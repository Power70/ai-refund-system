import type { DemoCustomer } from './demo-catalog.types.js';

/**
 * The demo CRM: 15 customers, each with 1–3 orders. Order numbers are fixed (so the
 * README can list them) but non-sequential. Dates are relative to seeding time, so the
 * scenarios behave the same whenever the stack is started.
 * Prices are what the customer actually paid, in cents.
 */
export const DEMO_CATALOG: readonly DemoCustomer[] = [
  {
    name: 'Ada Okafor', email: 'ada.okafor@example.com', scenario: '#1 damaged shirt within 30 days → approved',
    orders: [
      { orderNumber: 'WN-7K3P9Q', deliveredDaysAgo: 5, items: [{ sku: 'SHIRT-OXF-BLU-M', name: 'Oxford shirt, blue', category: 'apparel', unitPricePaidMinor: 4999, quantity: 1 }] },
      { orderNumber: 'WN-2HX8LD', deliveredDaysAgo: 64, items: [{ sku: 'MUG-CER-WHT', name: 'Ceramic mug, white', category: 'home', unitPricePaidMinor: 1200, quantity: 2 }] },
    ],
  },
  {
    name: 'Ben Carter', email: 'ben.carter@example.com', scenario: '#2 damaged item after 45 days → denied (window)',
    orders: [
      { orderNumber: 'WN-Q4M1ZT', deliveredDaysAgo: 45, items: [{ sku: 'LAMP-DSK-BLK', name: 'Desk lamp, black', category: 'home', unitPricePaidMinor: 3500, quantity: 1 }] },
    ],
  },
  {
    name: 'Chika Eze', email: 'chika.eze@example.com', scenario: '#3 final-sale belt, changed mind → denied (final sale)',
    orders: [
      { orderNumber: 'WN-9TB6RW', deliveredDaysAgo: 10, items: [{ sku: 'BELT-LTH-BRN', name: 'Leather belt, brown (clearance)', category: 'accessories', unitPricePaidMinor: 2500, quantity: 1, finalSale: true }] },
      { orderNumber: 'WN-5VJ2NC', deliveredDaysAgo: 120, items: [{ sku: 'SCARF-WOL-GRY', name: 'Wool scarf, grey', category: 'accessories', unitPricePaidMinor: 2800, quantity: 1 }] },
    ],
  },
  {
    name: 'Daniel Mensah', email: 'daniel.mensah@example.com', scenario: '#4 final-sale item arrived damaged → escalated (conflict)',
    orders: [
      { orderNumber: 'WN-X8D3KF', deliveredDaysAgo: 3, items: [{ sku: 'JKT-DNM-IND-L', name: 'Denim jacket (final sale)', category: 'apparel', unitPricePaidMinor: 6000, quantity: 1, finalSale: true }] },
    ],
  },
  {
    name: 'Efe Adebayo', email: 'efe.adebayo@example.com', scenario: '#5 wrong laptop, $749 → escalated (over $500)',
    orders: [
      { orderNumber: 'WN-L6W9PH', deliveredDaysAgo: 4, items: [{ sku: 'LAPTOP-14-512', name: 'Laptop 14", 512 GB', category: 'electronics', unitPricePaidMinor: 74900, quantity: 1 }] },
      { orderNumber: 'WN-3RC7YB', deliveredDaysAgo: 30, items: [{ sku: 'SLEEVE-LAP-14', name: 'Laptop sleeve 14"', category: 'accessories', unitPricePaidMinor: 2200, quantity: 1 }] },
    ],
  },
  {
    name: 'Femi Johnson', email: 'femi.johnson@example.com', scenario: '#6 $280 item after $300 refunded on the same order → escalated (cumulative)',
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
    name: 'Grace Lee', email: 'grace.lee@example.com', scenario: '#7 two shirts, changed mind on one → AI asks which; approved',
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
    name: 'Hassan Bello', email: 'hassan.bello@example.com', scenario: '#8 item denied before, resubmitted with a new reason → escalated',
    orders: [
      { orderNumber: 'WN-Z2T5HM', deliveredDaysAgo: 12, items: [{ sku: 'HEADPH-OVR-BLK', name: 'Over-ear headphones', category: 'electronics', unitPricePaidMinor: 4000, quantity: 1 }] },
    ],
  },
  {
    name: 'Ifeoma Nwosu', email: 'ifeoma.nwosu@example.com', scenario: '#9 four requests in the last 30 days → escalated (frequency)',
    orders: [
      { orderNumber: 'WN-6PQ8XE', deliveredDaysAgo: 6, items: [{ sku: 'CANDLE-SOY-VAN', name: 'Soy candle, vanilla', category: 'home', unitPricePaidMinor: 3000, quantity: 1 }] },
      { orderNumber: 'WN-1YD4GU', deliveredDaysAgo: 15, items: [{ sku: 'TOWEL-BTH-SET', name: 'Bath towel set', category: 'home', unitPricePaidMinor: 4500, quantity: 1 }] },
      { orderNumber: 'WN-9MA3CJ', deliveredDaysAgo: 22, items: [{ sku: 'PILLOW-MEM-STD', name: 'Memory foam pillow', category: 'home', unitPricePaidMinor: 3800, quantity: 2 }] },
    ],
  },
  {
    name: 'Jide Afolabi', email: 'jide.afolabi@example.com', scenario: '#10 order not delivered yet → escalated',
    orders: [
      { orderNumber: 'WN-K5R2BW', deliveredDaysAgo: null, items: [{ sku: 'SPEAKER-BT-MINI', name: 'Bluetooth speaker, mini', category: 'electronics', unitPricePaidMinor: 5000, quantity: 1 }] },
    ],
  },
  {
    name: 'Kemi Adeyemi', email: 'kemi.adeyemi@example.com', scenario: '#11 shirt + final-sale belt, changed mind → shirt refunded, belt not',
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
    name: 'Lara Smith', email: 'lara.smith@example.com', scenario: '#12 eligible item, injection attempt in chat → escalated',
    orders: [
      { orderNumber: 'WN-7XW2QD', deliveredDaysAgo: 5, items: [{ sku: 'BOTTLE-STL-750', name: 'Steel water bottle, 750 ml', category: 'outdoor', unitPricePaidMinor: 5500, quantity: 1 }] },
    ],
  },
  {
    name: 'Musa Ibrahim', email: 'musa.ibrahim@example.com', scenario: '#13 AI reads "changed mind", customer edits to "damaged" → escalated',
    orders: [
      { orderNumber: 'WN-B4N6ZR', deliveredDaysAgo: 6, items: [{ sku: 'BAG-BPK-GRY', name: 'Backpack, grey', category: 'accessories', unitPricePaidMinor: 6500, quantity: 1 }] },
      { orderNumber: 'WN-5QE1MK', deliveredDaysAgo: 40, items: [{ sku: 'CAP-BSB-BLK', name: 'Baseball cap, black', category: 'accessories', unitPricePaidMinor: 1800, quantity: 1 }] },
    ],
  },
  {
    name: 'Ngozi Obi', email: 'ngozi.obi@example.com', scenario: '#14 exactly $500.00, damaged → approved (boundary)',
    orders: [
      { orderNumber: 'WN-2JC8WP', deliveredDaysAgo: 2, items: [{ sku: 'TABLET-10-128', name: 'Tablet 10", 128 GB', category: 'electronics', unitPricePaidMinor: 50000, quantity: 1 }] },
    ],
  },
  {
    name: 'Obi Chukwu', email: 'obi.chukwu@example.com', scenario: '#15 item already fully refunded → nothing left to refund',
    orders: [
      { orderNumber: 'WN-H9F3LX', deliveredDaysAgo: 9, items: [{ sku: 'KETTLE-ELC-1L', name: 'Electric kettle, 1 L', category: 'home', unitPricePaidMinor: 7000, quantity: 1 }] },
      { orderNumber: 'WN-6TZ5DN', deliveredDaysAgo: 3, items: [{ sku: 'TOASTER-2SL', name: 'Toaster, 2-slice', category: 'home', unitPricePaidMinor: 3900, quantity: 1 }] },
    ],
  },
];
