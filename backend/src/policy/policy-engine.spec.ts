import { readFileSync } from 'node:fs';
import { loadPolicyScenarios, scenarioToEngineInput } from '../../test/support/policy-fixtures.js';
import { wholeDaysBetween, evaluateCondition, MissingFactError, evaluateRequest, InvalidEvaluationInputError, type LineInput } from './policy-engine.js';
import { parsePolicy, type FactValues, type PolicyDocument } from './policy-schema.js';

describe('wholeDaysBetween', () => {
  const t0 = new Date('2026-09-01T12:00:00Z');
  it.each([
    ['2026-09-01T12:00:00Z', 0],
    ['2026-09-02T11:59:59Z', 0],
    ['2026-09-02T12:00:00Z', 1],
    ['2026-10-01T11:59:59Z', 29],
    ['2026-10-01T12:00:00Z', 30],
    ['2026-10-02T11:59:59Z', 30],
    ['2026-10-02T12:00:00Z', 31],
  ])('to %s → %i', (to, days) => {
    expect(wholeDaysBetween(t0, new Date(to))).toBe(days);
  });
});

const conditionFacts: FactValues = {
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
    expect(evaluateCondition({ fact: 'item.daysSinceDelivery', op, value }, conditionFacts)).toBe(expected);
  });

  it('day 30 is inside a 30-day window and day 31 is outside', () => {
    const expired = { fact: 'item.daysSinceDelivery', op: 'gt', value: 30 } as const;
    expect(evaluateCondition(expired, conditionFacts)).toBe(false);
    expect(evaluateCondition(expired, { ...conditionFacts, 'item.daysSinceDelivery': 31 })).toBe(true);
  });

  it('handles in / notIn for reasons', () => {
    expect(evaluateCondition({ fact: 'claim.reason', op: 'in', value: ['DAMAGED', 'WRONG_ITEM'] }, conditionFacts)).toBe(true);
    expect(evaluateCondition({ fact: 'claim.reason', op: 'notIn', value: ['DAMAGED', 'WRONG_ITEM'] }, conditionFacts)).toBe(false);
  });

  it('compares booleans and strings strictly', () => {
    expect(evaluateCondition({ fact: 'item.finalSale', op: 'eq', value: false }, conditionFacts)).toBe(true);
    expect(evaluateCondition({ fact: 'item.category', op: 'eq', value: 'Apparel' }, conditionFacts)).toBe(false);
  });

  describe('null conditionFacts', () => {
    const undelivered: FactValues = { ...conditionFacts, 'item.delivered': false, 'item.daysSinceDelivery': null };

    it('makes every comparison false, in both directions', () => {
      for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const) {
        expect(evaluateCondition({ fact: 'item.daysSinceDelivery', op, value: 30 }, undelivered)).toBe(false);
      }
      expect(evaluateCondition({ fact: 'item.daysSinceDelivery', op: 'in', value: [30] }, undelivered)).toBe(false);
      expect(evaluateCondition({ fact: 'item.daysSinceDelivery', op: 'notIn', value: [30] }, undelivered)).toBe(false);
    });

    it('matches only isNull', () => {
      expect(evaluateCondition({ fact: 'item.daysSinceDelivery', op: 'isNull' }, undelivered)).toBe(true);
      expect(evaluateCondition({ fact: 'item.daysSinceDelivery', op: 'isNull' }, conditionFacts)).toBe(false);
    });
  });

  it('combines with all / any / not, including nesting', () => {
    const finalSaleDefect = {
      all: [
        { fact: 'item.finalSale', op: 'eq', value: true },
        { any: [{ fact: 'claim.reason', op: 'eq', value: 'DAMAGED' }, { fact: 'claim.reason', op: 'eq', value: 'WRONG_ITEM' }] },
      ],
    } as const;
    expect(evaluateCondition(finalSaleDefect, conditionFacts)).toBe(false);
    expect(evaluateCondition(finalSaleDefect, { ...conditionFacts, 'item.finalSale': true })).toBe(true);
    expect(evaluateCondition({ not: finalSaleDefect }, conditionFacts)).toBe(true);
  });

  it('throws when a referenced fact was not supplied (a bug, never silently false)', () => {
    expect(() => evaluateCondition({ fact: 'item.priorDeniedRequest', op: 'eq', value: true }, conditionFacts)).toThrow(MissingFactError);
  });
});

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

const realPolicy = parsePolicy(readFileSync(new URL('../../../policy/refund-policy.yaml', import.meta.url), 'utf8'));
const scenarios = loadPolicyScenarios();

describe('refund policy scenarios (policy/scenarios.yaml)', () => {
  it.each(scenarios.map((s) => [s.name, s] as const))('%s', (_name, scenario) => {
    const { lines, history } = scenarioToEngineInput(scenario);
    const result = evaluateRequest(realPolicy, lines, history);

    expect({
      status: result.status,
      approved: result.approvedAmountMinor,
      items: result.lines.map((l) => l.outcome),
      rules: result.lines.map((l) => l.decidingRuleId ?? 'DEFAULT'),
    }).toEqual({
      status: scenario.expect.status,
      approved: scenario.expect.approved,
      items: scenario.expect.items,
      rules: scenario.expect.rules,
    });

    if (scenario.expect.requestRules) {
      const matched = result.requestTrace.filter((t) => t.matched).map((t) => t.ruleId);
      expect(matched).toEqual(scenario.expect.requestRules);
    }
  });

  it('every policy rule is exercised by at least one scenario', () => {
    const exercised = new Set(
      scenarios.flatMap((s) => [...s.expect.rules, ...(s.expect.requestRules ?? [])]),
    );
    const allRules = [...realPolicy.lineRules, ...realPolicy.requestRules].map((r) => r.id);
    expect(allRules.filter((id) => !exercised.has(id))).toEqual([]);
  });
});
