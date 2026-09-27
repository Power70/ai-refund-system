import { DEMO_CATALOG } from './demo-catalog.js';
import { DEMO_HISTORY } from './demo-history.js';

describe('demo history data', () => {
  it('uses unique ids in the exact format the database enforces', () => {
    const ids = DEMO_HISTORY.map((h) => h.publicId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^rr_[0-9a-hjkmnp-tv-z]{12}$/);
  });

  it('only references customers, orders and SKUs that exist in the catalog', () => {
    for (const entry of DEMO_HISTORY) {
      const customer = DEMO_CATALOG.find((c) => c.email === entry.customerEmail);
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
