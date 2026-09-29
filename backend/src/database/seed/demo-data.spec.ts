import { wholeDaysBetween } from '../../policy/policy-engine.js';
import { demoEmail, demoOrderDates, DEMO_CATALOG, DEMO_HISTORY } from './demo-data.js';

const now = new Date('2026-09-27T09:00:00Z');

describe('demoOrderDates', () => {
  it('reads as exactly N whole days old now and for the next 23 hours', () => {
    const { deliveredAt } = demoOrderDates(30, now);
    expect(wholeDaysBetween(deliveredAt!, now)).toBe(30);
    expect(wholeDaysBetween(deliveredAt!, new Date(now.getTime() + 22 * 3_600_000))).toBe(30);
  });

  it('places the order before delivery', () => {
    const { placedAt, deliveredAt } = demoOrderDates(5, now);
    expect(placedAt.getTime()).toBeLessThan(deliveredAt!.getTime());
  });

  it('leaves undelivered orders without a delivery date, placed in the past', () => {
    const { placedAt, deliveredAt } = demoOrderDates(null, now);
    expect(deliveredAt).toBeNull();
    expect(placedAt.getTime()).toBeLessThan(now.getTime());
  });
});

const orders = DEMO_CATALOG.flatMap((c) => c.orders);
const items = orders.flatMap((o) => o.items);

function orderOf(alias: number, index = 0) {
  const customer = DEMO_CATALOG.find((c) => c.alias === alias);
  if (!customer) throw new Error(`no demo customer ${alias}`);
  return customer.orders[index];
}

function daysSinceDelivery(alias: number, index = 0): number | null {
  const { deliveredAt } = demoOrderDates(orderOf(alias, index).deliveredDaysAgo, now);
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

  it('numbers the customers 1 to 15, one plus-alias each, and holds no email address', () => {
    expect(DEMO_CATALOG.map((c) => c.alias)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(JSON.stringify(DEMO_CATALOG)).not.toContain('@');
  });

  it('builds each email from the configured base', () => {
    expect(demoEmail('Someone@Example.com', 3)).toBe('someone+3@example.com');
    expect(demoEmail('a.b@mail.example.org', 15)).toBe('a.b+15@mail.example.org');
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
      expect(daysSinceDelivery(1)).toBe(5);
      expect(orderOf(1).items[0].unitPricePaidMinor).toBe(4999);
    });
    it('#2 Ben: delivered 45 days ago (outside the window)', () => {
      expect(daysSinceDelivery(2)).toBe(45);
    });
    it('#3 Chika and #4 Daniel: final-sale items', () => {
      expect(orderOf(3).items[0].finalSale).toBe(true);
      expect(orderOf(4).items[0].finalSale).toBe(true);
    });
    it('#5 Efe: $749 laptop', () => {
      expect(orderOf(5).items[0].unitPricePaidMinor).toBe(74900);
    });
    it('#7 Grace: two shirts in one order', () => {
      expect(orderOf(7).items.map((i) => i.name)).toEqual(['Linen shirt, blue', 'Linen shirt, white']);
    });
    it('#10 Jide: not delivered yet', () => {
      expect(daysSinceDelivery(10)).toBeNull();
    });
    it('#11 Kemi: a regular shirt and a final-sale belt in one order', () => {
      expect(orderOf(11).items.map((i) => i.finalSale ?? false)).toEqual([false, true]);
    });
    it('#14 Ngozi: exactly $500.00', () => {
      expect(orderOf(14).items[0].unitPricePaidMinor).toBe(50000);
    });
    it('Ifeoma has three orders to build request history on', () => {
      expect(DEMO_CATALOG.find((c) => c.alias === 9)?.orders).toHaveLength(3);
    });
  });
});

describe('demo history data', () => {
  it('uses unique ids in the exact format the database enforces', () => {
    const ids = DEMO_HISTORY.map((h) => h.publicId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^rr_[0-9a-hjkmnp-tv-z]{12}$/);
  });

  it('only references customers, orders and SKUs that exist in the catalog', () => {
    for (const entry of DEMO_HISTORY) {
      const customer = DEMO_CATALOG.find((c) => c.alias === entry.customerAlias);
      const order = customer?.orders.find((o) => o.orderNumber === entry.orderNumber);
      expect(order, entry.publicId).toBeDefined();
      for (const line of entry.lines) expect(order!.items.some((i) => i.sku === line.sku), `${entry.publicId} ${line.sku}`).toBe(true);
    }
  });

  it('never makes a request before the item was delivered', () => {
    for (const entry of DEMO_HISTORY) {
      const order = DEMO_CATALOG.flatMap((c) => c.orders).find((o) => o.orderNumber === entry.orderNumber)!;
      expect(order.deliveredDaysAgo, entry.publicId).not.toBeNull();
      expect(entry.daysAgo, entry.publicId).toBeLessThan(order.deliveredDaysAgo!);
    }
  });

  it('never refunds more of an item than was bought', () => {
    const requested = new Map<string, number>();
    for (const entry of DEMO_HISTORY) for (const l of entry.lines) requested.set(`${entry.orderNumber}/${l.sku}`, (requested.get(`${entry.orderNumber}/${l.sku}`) ?? 0) + l.quantity);
    for (const [key, qty] of requested) {
      const [orderNumber, sku] = key.split('/');
      const item = DEMO_CATALOG.flatMap((c) => c.orders).find((o) => o.orderNumber === orderNumber)!.items.find((i) => i.sku === sku)!;
      expect(qty, key).toBeLessThanOrEqual(item.quantity);
    }
  });

  it('is listed oldest first, so later entries see earlier ones', () => {
    const days = DEMO_HISTORY.map((h) => h.daysAgo);
    expect(days).toEqual([...days].sort((a, b) => b - a));
  });
});
