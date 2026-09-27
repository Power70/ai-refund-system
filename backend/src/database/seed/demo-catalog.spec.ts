import { wholeDaysBetween } from '../../policy/whole-days-between.js';
import { DEMO_CATALOG } from './demo-catalog.js';
import { demoOrderDates } from './demo-order-dates.js';

const now = new Date('2026-09-27T09:00:00Z');
const orders = DEMO_CATALOG.flatMap((c) => c.orders);
const items = orders.flatMap((o) => o.items);

function orderOf(email: string, index = 0) {
  const customer = DEMO_CATALOG.find((c) => c.email === email);
  if (!customer) throw new Error(`no demo customer ${email}`);
  return customer.orders[index];
}

function daysSinceDelivery(email: string, index = 0): number | null {
  const { deliveredAt } = demoOrderDates(orderOf(email, index).deliveredDaysAgo, now);
  return deliveredAt ? wholeDaysBetween(deliveredAt, now) : null;
}

describe('demo catalog', () => {
  it('has about 15 customers, each with an order history of 1–3 orders', () => {
    expect(DEMO_CATALOG).toHaveLength(15);
    for (const c of DEMO_CATALOG) {
      expect(c.orders.length).toBeGreaterThanOrEqual(1);
      expect(c.orders.length).toBeLessThanOrEqual(3);
    }
  });

  it('uses unique, lower-case, reserved-domain emails', () => {
    const emails = DEMO_CATALOG.map((c) => c.email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const e of emails) expect(e).toMatch(/^[a-z.]+@example\.com$/);
  });

  it('uses unique, non-sequential order numbers', () => {
    const numbers = orders.map((o) => o.orderNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) expect(n).toMatch(/^WN-[A-Z0-9]{6}$/);
    // Not a counter: no two numbers differ only in their last character.
    const stems = numbers.map((n) => n.slice(0, -1));
    expect(new Set(stems).size).toBe(stems.length);
  });

  it('stores money as whole cents and quantities as positive integers', () => {
    for (const i of items) {
      expect(Number.isSafeInteger(i.unitPricePaidMinor) && i.unitPricePaidMinor >= 0).toBe(true);
      expect(Number.isSafeInteger(i.quantity) && i.quantity > 0).toBe(true);
    }
  });

  it('keeps SKUs unique within each order', () => {
    for (const o of orders) expect(new Set(o.items.map((i) => i.sku)).size).toBe(o.items.length);
  });

  describe('scenario facts come out exactly as intended', () => {
    it('#1 Ada: $49.99 shirt delivered 5 days ago', () => {
      expect(daysSinceDelivery('ada.okafor@example.com')).toBe(5);
      expect(orderOf('ada.okafor@example.com').items[0].unitPricePaidMinor).toBe(4999);
    });
    it('#2 Ben: delivered 45 days ago (outside the window)', () => {
      expect(daysSinceDelivery('ben.carter@example.com')).toBe(45);
    });
    it('#3 Chika and #4 Daniel: final-sale items', () => {
      expect(orderOf('chika.eze@example.com').items[0].finalSale).toBe(true);
      expect(orderOf('daniel.mensah@example.com').items[0].finalSale).toBe(true);
    });
    it('#5 Efe: $749 laptop', () => {
      expect(orderOf('efe.adebayo@example.com').items[0].unitPricePaidMinor).toBe(74900);
    });
    it('#7 Grace: two shirts in one order', () => {
      expect(orderOf('grace.lee@example.com').items.map((i) => i.name)).toEqual(['Linen shirt, blue', 'Linen shirt, white']);
    });
    it('#10 Jide: not delivered yet', () => {
      expect(daysSinceDelivery('jide.afolabi@example.com')).toBeNull();
    });
    it('#11 Kemi: a regular shirt and a final-sale belt in one order', () => {
      expect(orderOf('kemi.adeyemi@example.com').items.map((i) => i.finalSale ?? false)).toEqual([false, true]);
    });
    it('#14 Ngozi: exactly $500.00', () => {
      expect(orderOf('ngozi.obi@example.com').items[0].unitPricePaidMinor).toBe(50000);
    });
    it('Ifeoma has three orders to build request history on', () => {
      expect(DEMO_CATALOG.find((c) => c.email === 'ifeoma.nwosu@example.com')?.orders).toHaveLength(3);
    });
  });
});
