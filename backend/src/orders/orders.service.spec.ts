import { computeQuantities } from './orders.service.js';

describe('computeQuantities', () => {
  const purchased = [
    { id: 'a', quantity: 3 },
    { id: 'b', quantity: 1 },
    { id: 'c', quantity: 2 },
  ];

  it('subtracts refunded and pending quantities', () => {
    const q = computeQuantities(purchased, [
      { orderItemId: 'a', refunded: 1, pending: 1 },
      { orderItemId: 'b', refunded: 0, pending: 1 },
    ]);
    expect(q.get('a')).toEqual({ purchased: 3, refunded: 1, pending: 1, refundable: 1 });
    expect(q.get('b')).toEqual({ purchased: 1, refunded: 0, pending: 1, refundable: 0 });
  });

  it('treats unused items as fully refundable', () => {
    expect(computeQuantities(purchased, []).get('c')).toEqual({ purchased: 2, refunded: 0, pending: 0, refundable: 2 });
  });

  it('never reports a negative refundable quantity', () => {
    expect(computeQuantities([{ id: 'a', quantity: 1 }], [{ orderItemId: 'a', refunded: 2, pending: 0 }]).get('a')?.refundable).toBe(0);
  });
});
