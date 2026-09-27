import { readFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { parsePolicy } from './parse-policy.js';
import { PolicyValidationError } from './policy-validation.error.js';

const realPolicyYaml = readFileSync(new URL('../../../policy/refund-policy.yaml', import.meta.url), 'utf8');

/** Minimal valid policy; each test breaks one thing. */
function basePolicy(): Record<string, unknown> {
  return {
    version: 'test-1',
    effectiveFrom: '2026-09-01T00:00:00Z',
    currency: 'USD',
    reviewEtaBusinessDays: 2,
    precedence: ['DENY', 'REVIEW', 'ALLOW'],
    defaultOutcome: 'REVIEW',
    reasons: ['DAMAGED', 'CHANGED_MIND'],
    lineRules: [
      { id: 'WINDOW_EXPIRED', when: { fact: 'item.daysSinceDelivery', op: 'gt', value: 30 }, outcome: 'DENY', publicReason: 'Too late.' },
    ],
    requestRules: [],
  };
}

function problemsFor(policy: Record<string, unknown>): string[] {
  try {
    parsePolicy(stringify(policy));
  } catch (error) {
    if (error instanceof PolicyValidationError) return error.problems;
    throw error;
  }
  return [];
}

function withLineRule(when: unknown, extra: Record<string, unknown> = {}) {
  const p = basePolicy();
  p.lineRules = [{ id: 'R', when, outcome: 'DENY', publicReason: 'x', ...extra }];
  return p;
}

describe('parsePolicy', () => {
  it('accepts the committed refund-policy.yaml', () => {
    const policy = parsePolicy(realPolicyYaml);
    expect(policy.version).toBe('2026.09-1');
    expect(policy.lineRules.map((r) => r.id)).toContain('FINAL_SALE_DEFECT_CONFLICT');
    expect(policy.requestRules.find((r) => r.id === 'HIGH_VALUE')?.when).toEqual({
      fact: 'request.cumulativeOrderRefundMinor', op: 'gt', value: 50000,
    });
  });

  it('accepts the minimal base policy', () => {
    expect(problemsFor(basePolicy())).toEqual([]);
  });

  it.each([
    ['an unknown fact', withLineRule({ fact: 'item.colour', op: 'eq', value: 'red' }), 'unknown fact "item.colour"'],
    ['a request fact in a line rule', withLineRule({ fact: 'customer.requestsLast30Days', op: 'gt', value: 3 }), 'cannot be used in line rules'],
    ['an operator that does not fit the type', withLineRule({ fact: 'item.finalSale', op: 'gt', value: 1 }), 'operator "gt" is not valid for boolean'],
    ['a value of the wrong type', withLineRule({ fact: 'item.daysSinceDelivery', op: 'gt', value: '30' }), 'is a number'],
    ['a missing value', withLineRule({ fact: 'item.daysSinceDelivery', op: 'gt' }), 'got no value'],
    ['a reason the policy does not offer', withLineRule({ fact: 'claim.reason', op: 'eq', value: 'WRONG_ITEM' }), '"WRONG_ITEM" is not one of the policy\'s reasons'],
    ['an empty list for "in"', withLineRule({ fact: 'claim.reason', op: 'in', value: [] }), 'needs a non-empty list'],
    ['isNull on a never-null fact', withLineRule({ fact: 'item.finalSale', op: 'isNull' }), 'never null'],
    ['a bad nested condition', withLineRule({ all: [{ fact: 'item.finalSale', op: 'eq', value: true }, { not: { fact: 'nope', op: 'eq', value: 1 } }] }), 'lineRules.0.when.all.1.not: unknown fact "nope"'],
    ['placeholders in a public reason', withLineRule({ fact: 'item.finalSale', op: 'eq', value: true }, { publicReason: 'Hi {{name}}' }), 'placeholders'],
    ['a lowercase rule id', withLineRule({ fact: 'item.finalSale', op: 'eq', value: true }, { id: 'window' }), 'UPPER_SNAKE_CASE'],
  ])('rejects %s', (_label, policy, expected) => {
    expect(problemsFor(policy).join('\n')).toContain(expected);
  });

  it('rejects ALLOW as the default outcome (must fail safe)', () => {
    expect(problemsFor({ ...basePolicy(), defaultOutcome: 'ALLOW' }).join()).toContain('defaultOutcome');
  });

  it('rejects a precedence that repeats an outcome', () => {
    expect(problemsFor({ ...basePolicy(), precedence: ['ALLOW', 'ALLOW', 'DENY'] }).join()).toContain('exactly once');
  });

  it('rejects duplicate rule ids across line and request rules', () => {
    const p = basePolicy();
    p.requestRules = [{ id: 'WINDOW_EXPIRED', when: { fact: 'customer.requestsLast30Days', op: 'gt', value: 3 }, outcome: 'REVIEW', publicReason: 'x' }];
    expect(problemsFor(p).join()).toContain('duplicate rule id "WINDOW_EXPIRED"');
  });

  it('rejects unknown top-level keys, so a typo cannot be silently ignored', () => {
    expect(problemsFor({ ...basePolicy(), defaultOutcom: 'DENY' }).join()).toMatch(/defaultOutcom/);
  });

  it('rejects duplicate YAML keys instead of letting the last one win', () => {
    const yaml = `${stringify(basePolicy())}\ndefaultOutcome: DENY\n`;
    expect(() => parsePolicy(yaml)).toThrow(/YAML syntax/);
  });

  it('reports rule problems even when other fields are also broken', () => {
    const p = withLineRule({ fact: 'item.daysSinceDelivry', op: 'gt', value: 30 });
    p.currency = 'usd';
    const problems = problemsFor(p).join('\n');
    expect(problems).toContain('currency');
    expect(problems).toContain('unknown fact "item.daysSinceDelivry"');
  });
});
