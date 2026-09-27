import { evaluateCondition } from './evaluate-condition.js';
import type { FactValues } from './fact-vocabulary.js';
import { MissingFactError } from './missing-fact.error.js';

const facts: FactValues = {
  'item.delivered': true,
  'item.daysSinceDelivery': 30,
  'item.finalSale': false,
  'item.category': 'apparel',
  'claim.reason': 'DAMAGED',
};

describe('evaluateCondition', () => {
  it.each([
    ['eq', 30, true],
    ['neq', 30, false],
    ['gt', 30, false],
    ['gte', 30, true],
    ['lt', 31, true],
    ['lte', 30, true],
  ] as const)('number %s %s → %s', (op, value, expected) => {
    expect(evaluateCondition({ fact: 'item.daysSinceDelivery', op, value }, facts)).toBe(expected);
  });

  it('day 30 is inside a 30-day window and day 31 is outside', () => {
    const expired = { fact: 'item.daysSinceDelivery', op: 'gt', value: 30 } as const;
    expect(evaluateCondition(expired, facts)).toBe(false);
    expect(evaluateCondition(expired, { ...facts, 'item.daysSinceDelivery': 31 })).toBe(true);
  });

  it('handles in / notIn for reasons', () => {
    expect(evaluateCondition({ fact: 'claim.reason', op: 'in', value: ['DAMAGED', 'WRONG_ITEM'] }, facts)).toBe(true);
    expect(evaluateCondition({ fact: 'claim.reason', op: 'notIn', value: ['DAMAGED', 'WRONG_ITEM'] }, facts)).toBe(false);
  });

  it('compares booleans and strings strictly', () => {
    expect(evaluateCondition({ fact: 'item.finalSale', op: 'eq', value: false }, facts)).toBe(true);
    expect(evaluateCondition({ fact: 'item.category', op: 'eq', value: 'Apparel' }, facts)).toBe(false);
  });

  describe('null facts', () => {
    const undelivered: FactValues = { ...facts, 'item.delivered': false, 'item.daysSinceDelivery': null };

    it('makes every comparison false, in both directions', () => {
      for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const) {
        expect(evaluateCondition({ fact: 'item.daysSinceDelivery', op, value: 30 }, undelivered)).toBe(false);
      }
      expect(evaluateCondition({ fact: 'item.daysSinceDelivery', op: 'in', value: [30] }, undelivered)).toBe(false);
      expect(evaluateCondition({ fact: 'item.daysSinceDelivery', op: 'notIn', value: [30] }, undelivered)).toBe(false);
    });

    it('matches only isNull', () => {
      expect(evaluateCondition({ fact: 'item.daysSinceDelivery', op: 'isNull' }, undelivered)).toBe(true);
      expect(evaluateCondition({ fact: 'item.daysSinceDelivery', op: 'isNull' }, facts)).toBe(false);
    });
  });

  it('combines with all / any / not, including nesting', () => {
    const finalSaleDefect = {
      all: [
        { fact: 'item.finalSale', op: 'eq', value: true },
        { any: [{ fact: 'claim.reason', op: 'eq', value: 'DAMAGED' }, { fact: 'claim.reason', op: 'eq', value: 'WRONG_ITEM' }] },
      ],
    } as const;
    expect(evaluateCondition(finalSaleDefect, facts)).toBe(false);
    expect(evaluateCondition(finalSaleDefect, { ...facts, 'item.finalSale': true })).toBe(true);
    expect(evaluateCondition({ not: finalSaleDefect }, facts)).toBe(true);
  });

  it('throws when a referenced fact was not supplied (a bug, never silently false)', () => {
    expect(() => evaluateCondition({ fact: 'item.priorDeniedRequest', op: 'eq', value: true }, facts)).toThrow(MissingFactError);
  });
});
