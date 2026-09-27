import { evaluateRequest } from './evaluate-request.js';
import type { FactValues } from './fact-vocabulary.js';
import { InvalidEvaluationInputError } from './invalid-evaluation-input.error.js';
import type { PolicyDocument } from './policy.schema.js';
import type { LineInput } from './policy-evaluation.types.js';

const noHistory = { 'order.refundedOrPendingMinor': 0, 'customer.requestsLast30Days': 0 };

function facts(overrides: FactValues = {}): FactValues {
  return {
    'item.delivered': true,
    'item.daysSinceDelivery': 5,
    'item.finalSale': false,
    'item.category': 'general',
    'item.priorDeniedRequest': false,
    'claim.reason': 'DAMAGED',
    ...overrides,
  };
}

function line(id: string, amountMinor: number, overrides: FactValues = {}): LineInput {
  return { lineId: id, amountMinor, facts: facts(overrides) };
}

/** A small policy where two rules can match the same item with different outcomes. */
function policy(overrides: Partial<PolicyDocument> = {}): PolicyDocument {
  return {
    version: 't1',
    effectiveFrom: '2026-01-01T00:00:00Z',
    currency: 'USD',
    reviewEtaBusinessDays: 2,
    precedence: ['DENY', 'REVIEW', 'ALLOW'],
    defaultOutcome: 'REVIEW',
    defaultPublicReason: 'A person will review this.',
    reasons: ['DAMAGED', 'OTHER'],
    lineRules: [
      { id: 'DAMAGED_OK', when: { fact: 'claim.reason', op: 'eq', value: 'DAMAGED' }, outcome: 'ALLOW', publicReason: 'Damaged items qualify.' },
      { id: 'OLD_ITEM', when: { fact: 'item.daysSinceDelivery', op: 'gt', value: 30 }, outcome: 'DENY', publicReason: 'Too old.' },
      { id: 'ALSO_OLD', when: { fact: 'item.daysSinceDelivery', op: 'gt', value: 20 }, outcome: 'DENY', publicReason: 'Also too old.' },
    ],
    requestRules: [
      { id: 'BIG', when: { fact: 'request.cumulativeOrderRefundMinor', op: 'gt', value: 10000 }, outcome: 'REVIEW', publicReason: 'Big refund.' },
    ],
    ...overrides,
  };
}

describe('evaluateRequest', () => {
  it('lets the higher-precedence outcome win when several rules match', () => {
    const [l] = evaluateRequest(policy(), [line('a', 100, { 'item.daysSinceDelivery': 40 })], noHistory).lines;
    expect(l.outcome).toBe('DENY');
  });

  it('names the first matching rule in file order as the deciding rule', () => {
    const [l] = evaluateRequest(policy(), [line('a', 100, { 'item.daysSinceDelivery': 40 })], noHistory).lines;
    expect(l.decidingRuleId).toBe('OLD_ITEM');
    expect(l.publicReason).toBe('Too old.');
  });

  it('respects a different precedence order from the policy file', () => {
    const p = policy({ precedence: ['ALLOW', 'DENY', 'REVIEW'] });
    const [l] = evaluateRequest(p, [line('a', 100, { 'item.daysSinceDelivery': 40 })], noHistory).lines;
    expect(l.outcome).toBe('ALLOW');
  });

  it('keeps a complete trace of every rule, matched or not', () => {
    const [l] = evaluateRequest(policy(), [line('a', 100)], noHistory).lines;
    expect(l.trace).toEqual([
      { ruleId: 'DAMAGED_OK', outcome: 'ALLOW', matched: true },
      { ruleId: 'OLD_ITEM', outcome: 'DENY', matched: false },
      { ruleId: 'ALSO_OLD', outcome: 'DENY', matched: false },
    ]);
  });

  it('applies the default outcome and reason when no rule matches', () => {
    const result = evaluateRequest(policy(), [line('a', 100, { 'claim.reason': 'OTHER' })], noHistory);
    expect(result.lines[0]).toMatchObject({ outcome: 'REVIEW', decidingRuleId: null, publicReason: 'A person will review this.' });
    expect(result).toMatchObject({ status: 'ESCALATED', escalationRuleIds: ['DEFAULT'] });
  });

  it('adds what is already refunded or pending on the order before checking request rules', () => {
    const result = evaluateRequest(policy(), [line('a', 6000)], { ...noHistory, 'order.refundedOrPendingMinor': 5000 });
    expect(result.requestFacts).toMatchObject({ 'request.candidateAmountMinor': 6000, 'request.cumulativeOrderRefundMinor': 11000 });
    expect(result.status).toBe('ESCALATED');
    expect(result.escalationRuleIds).toEqual(['BIG']);
  });

  it('counts only ALLOW lines toward the amount', () => {
    const result = evaluateRequest(policy(), [line('a', 6000), line('b', 9000, { 'item.daysSinceDelivery': 40 })], noHistory);
    expect(result).toMatchObject({ status: 'APPROVED', approvedAmountMinor: 6000 });
    expect(result.requestFacts?.['request.candidateAmountMinor']).toBe(6000);
  });

  it('skips request rules entirely when every line is denied', () => {
    const result = evaluateRequest(policy(), [line('a', 99999, { 'item.daysSinceDelivery': 40 })], noHistory);
    expect(result).toMatchObject({ status: 'DENIED', requestRulesEvaluated: false, requestTrace: [], requestFacts: null });
  });

  it('denies the whole request when a request rule says DENY', () => {
    const p = policy({
      requestRules: [
        { id: 'BLOCKED', when: { fact: 'customer.requestsLast30Days', op: 'gt', value: 10 }, outcome: 'DENY', publicReason: 'Blocked.' },
      ],
    });
    const result = evaluateRequest(p, [line('a', 100)], { ...noHistory, 'customer.requestsLast30Days': 11 });
    expect(result).toMatchObject({ status: 'DENIED', approvedAmountMinor: 0, requestDecidingRuleId: 'BLOCKED' });
  });

  it('never reports an approved amount for escalated requests', () => {
    const result = evaluateRequest(policy(), [line('a', 20000)], noHistory);
    expect(result).toMatchObject({ status: 'ESCALATED', approvedAmountMinor: 0 });
  });

  it.each([
    ['no lines', [], noHistory],
    ['duplicate line ids', [line('a', 1), line('a', 2)], noHistory],
    ['a fractional amount', [line('a', 10.5)], noHistory],
    ['a negative amount', [line('a', -1)], noHistory],
    ['negative history', [line('a', 1)], { ...noHistory, 'order.refundedOrPendingMinor': -5 }],
  ] as const)('rejects %s as a programming error', (_label, lines, history) => {
    expect(() => evaluateRequest(policy(), lines, history)).toThrow(InvalidEvaluationInputError);
  });
});
