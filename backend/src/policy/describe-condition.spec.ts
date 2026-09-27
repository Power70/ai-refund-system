import { describeCondition } from './describe-condition.js';

describe('describeCondition', () => {
  it.each([
    [{ fact: 'item.delivered', op: 'eq', value: false }, 'the item has not been delivered'],
    [{ fact: 'item.finalSale', op: 'neq', value: true }, 'the item is not final sale'],
    [{ fact: 'item.daysSinceDelivery', op: 'gt', value: 30 }, 'days since delivery is more than 30'],
    [{ fact: 'item.daysSinceDelivery', op: 'isNull' }, 'days since delivery is unknown'],
    [{ fact: 'claim.reason', op: 'eq', value: 'CHANGED_MIND' }, 'the reason is "Changed mind"'],
    [{ fact: 'claim.reason', op: 'in', value: ['DAMAGED', 'WRONG_ITEM'] }, 'the reason is one of "Damaged", "Wrong item"'],
    [{ fact: 'claim.reason', op: 'notIn', value: ['DAMAGED', 'WRONG_ITEM'] }, 'the reason is none of "Damaged", "Wrong item"'],
    [{ fact: 'claim.reason', op: 'in', value: ['OTHER'] }, 'the reason is "Other"'],
    [{ fact: 'request.cumulativeOrderRefundMinor', op: 'gt', value: 50000 }, "the order's total refunds (including this request) is more than $500.00"],
    [{ fact: 'item.category', op: 'eq', value: 'electronics' }, 'the item category is "electronics"'],
  ] as const)('%j → %s', (condition, expected) => {
    expect(describeCondition(condition, 'USD')).toBe(expected);
  });

  it('formats money in the policy currency', () => {
    expect(describeCondition({ fact: 'order.refundedOrPendingMinor', op: 'gte', value: 12345 }, 'EUR')).toBe(
      'the amount already refunded or pending on the order is at least €123.45',
    );
  });

  it('parenthesises nested groups so the meaning is kept', () => {
    const text = describeCondition(
      {
        all: [
          { fact: 'item.finalSale', op: 'eq', value: true },
          { any: [{ fact: 'claim.reason', op: 'eq', value: 'DAMAGED' }, { fact: 'item.daysSinceDelivery', op: 'lt', value: 3 }] },
        ],
      },
      'USD',
    );
    expect(text).toBe('the item is final sale and (the reason is "Damaged" or days since delivery is less than 3)');
  });

  it('describes negation explicitly', () => {
    expect(describeCondition({ not: { fact: 'item.delivered', op: 'eq', value: true } }, 'USD')).toBe(
      'it is not the case that the item has been delivered',
    );
  });
});
