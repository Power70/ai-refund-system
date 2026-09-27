import type { PolicyDocument } from './policy.schema.js';
import { GENERATED_NOTICE, renderPolicyMarkdown } from './render-policy-markdown.js';

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
