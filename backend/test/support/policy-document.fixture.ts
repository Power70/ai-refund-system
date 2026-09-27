import type { PolicyDocument } from '../../src/policy/policy.schema.js';

/** A small valid policy for registry tests; vary version/effectiveFrom/threshold per case. */
export function policyDocument(version: string, effectiveFrom: string, windowDays = 30): PolicyDocument {
  return {
    version,
    effectiveFrom,
    currency: 'USD',
    reviewEtaBusinessDays: 2,
    precedence: ['DENY', 'REVIEW', 'ALLOW'],
    defaultOutcome: 'REVIEW',
    defaultPublicReason: 'A team member will review this request.',
    reasons: ['DAMAGED', 'OTHER'],
    lineRules: [
      {
        id: 'WINDOW_EXPIRED',
        when: { fact: 'item.daysSinceDelivery', op: 'gt', value: windowDays },
        outcome: 'DENY',
        publicReason: 'Too late.',
      },
    ],
    requestRules: [],
  };
}
