import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** Shared by the policy, the AI intake and the UI. */
export const REFUND_REASONS = [
  'DAMAGED',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'CHANGED_MIND',
  'OTHER',
] as const;

export type RefundReason = (typeof REFUND_REASONS)[number];

/** Customer-facing; used for quick replies and in the prompt. */
export const REASON_LABELS: Record<RefundReason, string> = {
  DAMAGED: 'It arrived damaged or defective',
  WRONG_ITEM: 'I received the wrong item',
  NOT_AS_DESCRIBED: "It's not as described",
  CHANGED_MIND: 'I changed my mind',
  OTHER: 'Something else',
};

/** "line" facts describe one requested item; "request" facts the whole request. */
export type FactScope = 'line' | 'request';
export type FactType = 'boolean' | 'number' | 'string' | 'reason';

export interface FactDefinition {
  scope: FactScope;
  type: FactType;
  nullable: boolean;
}

/** The only facts rules may reference; a new fact must also be supplied by the fact builder. */
export const FACT_VOCABULARY = {
  'item.delivered': { scope: 'line', type: 'boolean', nullable: false },
  'item.daysSinceDelivery': { scope: 'line', type: 'number', nullable: true },
  'item.finalSale': { scope: 'line', type: 'boolean', nullable: false },
  'item.category': { scope: 'line', type: 'string', nullable: false },
  'item.priorDeniedRequest': { scope: 'line', type: 'boolean', nullable: false },
  'claim.reason': { scope: 'line', type: 'reason', nullable: false },
  'request.candidateAmountMinor': { scope: 'request', type: 'number', nullable: false },
  'order.refundedOrPendingMinor': { scope: 'request', type: 'number', nullable: false },
  'request.cumulativeOrderRefundMinor': { scope: 'request', type: 'number', nullable: false },
  'customer.requestsLast30Days': { scope: 'request', type: 'number', nullable: false },
} as const satisfies Record<string, FactDefinition>;

export type FactName = keyof typeof FACT_VOCABULARY;
export type FactValue = boolean | number | string | null;
export type FactValues = Partial<Record<FactName, FactValue>>;

export function isFactName(name: string): name is FactName {
  return Object.hasOwn(FACT_VOCABULARY, name);
}

export const CONDITION_OPERATORS = ['eq', 'neq', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'isNull'] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export type ComparisonValue = boolean | number | string | ReadonlyArray<number | string>;

/** Rules are immutable after loading. */
export interface FactCondition {
  fact: FactName;
  op: ConditionOperator;
  value?: ComparisonValue;
}

export type PolicyCondition =
  | FactCondition
  | { all: readonly PolicyCondition[] }
  | { any: readonly PolicyCondition[] }
  | { not: PolicyCondition };

export interface ConditionIssue {
  path: (string | number)[];
  message: string;
}

const OPERATORS_BY_TYPE = {
  boolean: ['eq', 'neq', 'isNull'],
  number: ['eq', 'neq', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'isNull'],
  string: ['eq', 'neq', 'in', 'notIn', 'isNull'],
  reason: ['eq', 'neq', 'in', 'notIn'],
} as const satisfies Record<string, readonly ConditionOperator[]>;

/** Semantic checks on a structurally valid condition: fact names, scope, operators and value types. */
export function checkConditionTypes(
  node: unknown,
  scope: FactScope,
  allowedReasons: readonly string[],
  path: (string | number)[] = [],
): ConditionIssue[] {
  if (typeof node !== 'object' || node === null) return [];
  const obj = node as Record<string, unknown>;

  if (Array.isArray(obj.all)) return obj.all.flatMap((c, i) => checkConditionTypes(c, scope, allowedReasons, [...path, 'all', i]));
  if (Array.isArray(obj.any)) return obj.any.flatMap((c, i) => checkConditionTypes(c, scope, allowedReasons, [...path, 'any', i]));
  if (obj.not !== undefined) return checkConditionTypes(obj.not, scope, allowedReasons, [...path, 'not']);

  const fact = String(obj.fact);
  const op = obj.op as ConditionOperator;
  const value = obj.value;
  const at = (message: string): ConditionIssue[] => [{ path, message }];

  if (!isFactName(fact)) return at(`unknown fact "${fact}"`);
  const def = FACT_VOCABULARY[fact];
  if (def.scope !== scope) return at(`fact "${fact}" is a ${def.scope} fact and cannot be used in ${scope} rules`);

  const allowedOps: readonly string[] = OPERATORS_BY_TYPE[def.type];
  if (!allowedOps.includes(op)) return at(`operator "${op}" is not valid for ${def.type} fact "${fact}"`);

  if (op === 'isNull') {
    if (value !== undefined) return at('"isNull" takes no value');
    if (!def.nullable) return at(`fact "${fact}" is never null, so "isNull" would never match`);
    return [];
  }

  const isList = op === 'in' || op === 'notIn';
  const values: unknown[] = isList ? (Array.isArray(value) ? value : [Symbol('not-a-list')]) : [value];
  if (isList && (!Array.isArray(value) || value.length === 0)) return at(`"${op}" needs a non-empty list`);
  if (!isList && Array.isArray(value)) return at(`"${op}" needs a single value, not a list`);

  for (const v of values) {
    if (def.type === 'reason') {
      if (typeof v !== 'string' || !allowedReasons.includes(v)) {
        return at(`"${String(v)}" is not one of the policy's reasons (${allowedReasons.join(', ')})`);
      }
    } else if (typeof v !== def.type) {
      return at(`fact "${fact}" is a ${def.type}; got ${v === undefined ? 'no value' : JSON.stringify(v)}`);
    }
  }
  return [];
}

/** Accepts unvalidated input so rule issues are reported even when the rest of the file is broken. */
export function collectRuleIssues(raw: unknown): ConditionIssue[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const policy = raw as Record<string, unknown>;
  const reasons = Array.isArray(policy.reasons)
    ? policy.reasons.filter((r): r is string => (REFUND_REASONS as readonly unknown[]).includes(r))
    : [];

  const issues: ConditionIssue[] = [];
  const seenIds = new Set<string>();
  for (const [group, scope] of [['lineRules', 'line'], ['requestRules', 'request']] as const) {
    const rules = policy[group];
    if (!Array.isArray(rules)) continue;
    rules.forEach((rule: unknown, i) => {
      if (typeof rule !== 'object' || rule === null) return;
      const { id, when } = rule as { id?: unknown; when?: unknown };
      if (typeof id === 'string') {
        if (seenIds.has(id)) issues.push({ path: [group, i, 'id'], message: `duplicate rule id "${id}"` });
        seenIds.add(id);
      }
      for (const issue of checkConditionTypes(when, scope, reasons)) {
        issues.push({ path: [group, i, 'when', ...issue.path], message: issue.message });
      }
    });
  }
  return issues;
}

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

const publicReasonSchema = z
  .string()
  .min(1)
  .max(300)
  .refine((s) => !s.includes('{{'), 'publicReason cannot contain placeholders');

const ruleSchema = z.strictObject({
  id: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'rule ids are UPPER_SNAKE_CASE'),
  when: conditionSchema,
  outcome: z.enum(POLICY_OUTCOMES),
  // Shown to customers verbatim.
  publicReason: publicReasonSchema,
});

// No request-level ALLOW: it would bypass item rules.
const requestRuleSchema = ruleSchema.extend({
  outcome: z.enum(['DENY', 'REVIEW'], { error: 'request rules may only DENY or REVIEW' }),
});

export const policyDocumentSchema = z
  .strictObject({
    version: z.string().min(1).max(50),
    effectiveFrom: z.iso.datetime({ offset: true }),
    currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. USD'),
    reviewEtaBusinessDays: z.number().int().min(0).max(30),
    precedence: z.tuple([z.enum(POLICY_OUTCOMES), z.enum(POLICY_OUTCOMES), z.enum(POLICY_OUTCOMES)]),
    // Fail safe: unmatched items are never auto-approved.
    defaultOutcome: z.enum(['REVIEW', 'DENY']),
    defaultPublicReason: publicReasonSchema,
    reasons: z.array(z.enum(REFUND_REASONS)).min(1),
    lineRules: z.array(ruleSchema).min(1),
    requestRules: z.array(requestRuleSchema).default([]),
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

/** Carries every problem found, not just the first. */
export class PolicyValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid refund policy:\n- ${problems.join('\n- ')}`);
    this.name = 'PolicyValidationError';
  }
}

/** Full validation at load time, so no policy error can surface while deciding a request. */
export function parsePolicy(yamlText: string): PolicyDocument {
  let raw: unknown;
  try {
    // uniqueKeys: otherwise a duplicated key silently overrides the first.
    raw = parseYaml(yamlText, { uniqueKeys: true, prettyErrors: true });
  } catch (error) {
    throw new PolicyValidationError([`YAML syntax: ${(error as Error).message}`]);
  }

  const result = policyDocumentSchema.safeParse(raw);
  if (!result.success) {
    const format = (path: PropertyKey[], message: string) => `${path.map(String).join('.') || '(root)'}: ${message}`;
    const problems = result.error.issues.map((issue) => format(issue.path, issue.message));
    // The schema skips rule checks on broken structure; run them to report everything at once.
    for (const issue of collectRuleIssues(raw)) {
      const line = format(issue.path, issue.message);
      if (!problems.includes(line)) problems.push(line);
    }
    throw new PolicyValidationError(problems);
  }
  return result.data;
}
