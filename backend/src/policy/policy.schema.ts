import { z } from 'zod';
import { collectRuleIssues } from './collect-rule-issues.js';
import { CONDITION_OPERATORS, type PolicyCondition } from './policy-condition.types.js';
import { REFUND_REASONS } from './refund-reasons.js';

export const POLICY_OUTCOMES = ['ALLOW', 'DENY', 'REVIEW'] as const;
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

const comparisonValue = z.union([
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(z.union([z.number().finite(), z.string()])),
]);

// Structure only; fact names, scopes and value types are checked by checkConditionTypes.
export const conditionSchema: z.ZodType<PolicyCondition> = z.lazy(() =>
  z.union([
    z.strictObject({ fact: z.string(), op: z.enum(CONDITION_OPERATORS), value: comparisonValue.optional() }),
    z.strictObject({ all: z.array(conditionSchema).min(1) }),
    z.strictObject({ any: z.array(conditionSchema).min(1) }),
    z.strictObject({ not: conditionSchema }),
  ]),
) as z.ZodType<PolicyCondition>;

const ruleSchema = z.strictObject({
  id: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'rule ids are UPPER_SNAKE_CASE'),
  when: conditionSchema,
  outcome: z.enum(POLICY_OUTCOMES),
  // Shown to customers verbatim, so keep it short and free of template syntax.
  publicReason: z.string().min(1).max(300).refine((s) => !s.includes('{{'), 'publicReason cannot contain placeholders'),
});

export const policyDocumentSchema = z
  .strictObject({
    version: z.string().min(1).max(50),
    effectiveFrom: z.iso.datetime({ offset: true }),
    currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. USD'),
    reviewEtaBusinessDays: z.number().int().min(0).max(30),
    precedence: z.tuple([z.enum(POLICY_OUTCOMES), z.enum(POLICY_OUTCOMES), z.enum(POLICY_OUTCOMES)]),
    // Fail safe: a request no rule recognises goes to a human or is denied, never auto-approved.
    defaultOutcome: z.enum(['REVIEW', 'DENY']),
    reasons: z.array(z.enum(REFUND_REASONS)).min(1),
    lineRules: z.array(ruleSchema).min(1),
    requestRules: z.array(ruleSchema).default([]),
  })
  .superRefine((policy, ctx) => {
    if (new Set(policy.precedence).size !== POLICY_OUTCOMES.length) {
      ctx.addIssue({ code: 'custom', path: ['precedence'], message: 'must list ALLOW, DENY and REVIEW exactly once' });
    }
    if (new Set(policy.reasons).size !== policy.reasons.length) {
      ctx.addIssue({ code: 'custom', path: ['reasons'], message: 'contains duplicates' });
    }
    for (const issue of collectRuleIssues(policy)) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  });

export type PolicyDocument = z.infer<typeof policyDocumentSchema>;
export type PolicyRule = PolicyDocument['lineRules'][number];
