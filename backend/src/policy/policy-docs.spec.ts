import { readFileSync } from 'node:fs';
import { describeCondition, GENERATED_NOTICE, renderPolicyMarkdown } from './policy-docs.js';
import { parsePolicy, type PolicyDocument } from './policy-schema.js';

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

function policy(overrides: Partial<PolicyDocument> = {}): PolicyDocument {
  return {
    version: 'v9',
    effectiveFrom: '2026-10-05T00:00:00Z',
    currency: 'USD',
    reviewEtaBusinessDays: 3,
    precedence: ['DENY', 'REVIEW', 'ALLOW'],
    defaultOutcome: 'REVIEW',
    defaultPublicReason: 'A person will look at this.',
    reasons: ['DAMAGED', 'OTHER'],
    lineRules: [
      { id: 'LATE', when: { fact: 'item.daysSinceDelivery', op: 'gt', value: 14 }, outcome: 'DENY', publicReason: 'Too late | sorry.' },
    ],
    requestRules: [],
    ...overrides,
  };
}

describe('renderPolicyMarkdown', () => {
  const md = renderPolicyMarkdown(policy());

  it('starts with the do-not-edit notice', () => {
    expect(md.startsWith(GENERATED_NOTICE)).toBe(true);
  });

  it('shows version, effective date, currency and review time', () => {
    expect(md).toContain('Version **v9** · effective 5 October 2026 · amounts in USD');
    expect(md).toContain('answered within 3 business days');
  });

  it('lists the offered reasons and the precedence order', () => {
    expect(md).toContain('one of these reasons: Damaged, Other.');
    expect(md).toContain('in this order: Denied, then Needs review, then Approved.');
  });

  it('escapes table separators inside customer text', () => {
    expect(md).toContain('| `LATE` | days since delivery is more than 14 | Denied | Too late \\| sorry. |');
  });

  it('says so when there are no whole-request rules', () => {
    expect(md).toContain('## Whole-request rules\n\n_None._');
  });

  it('is deterministic', () => {
    expect(renderPolicyMarkdown(policy())).toBe(md);
  });
});

const read = (file: string) => readFileSync(new URL(`../../../policy/${file}`, import.meta.url), 'utf8');

describe('policy/refund-policy.md', () => {
  it('matches what refund-policy.yaml generates (run `npm run policy:docs` after editing the YAML)', () => {
    const expected = renderPolicyMarkdown(parsePolicy(read('refund-policy.yaml')));
    // Normalise line endings so a Windows checkout without .gitattributes still compares fairly.
    expect(read('refund-policy.md').replaceAll('\r\n', '\n')).toBe(expected);
  });
});
