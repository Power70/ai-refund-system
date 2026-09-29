import type { FactName, RefundReason, ComparisonValue, FactCondition, PolicyCondition, PolicyDocument, PolicyOutcome, PolicyRule } from './policy-schema.js';

export const BOOLEAN_FACT_PHRASES: Partial<Record<FactName, { true: string; false: string }>> = {
  'item.delivered': { true: 'the item has been delivered', false: 'the item has not been delivered' },
  'item.finalSale': { true: 'the item is final sale', false: 'the item is not final sale' },
  'item.priorDeniedRequest': {
    true: 'an earlier request for this item was denied',
    false: 'no earlier request for this item was denied',
  },
};

export const FACT_LABELS: Record<FactName, string> = {
  'item.delivered': 'delivery status',
  'item.daysSinceDelivery': 'days since delivery',
  'item.finalSale': 'final-sale status',
  'item.category': 'the item category',
  'item.priorDeniedRequest': 'earlier denied request',
  'claim.reason': 'the reason',
  'request.candidateAmountMinor': 'the amount qualifying in this request',
  'order.refundedOrPendingMinor': 'the amount already refunded or pending on the order',
  'request.cumulativeOrderRefundMinor': 'the order\'s total refunds (including this request)',
  'customer.requestsLast30Days': "the number of the customer's refund requests in the last 30 days",
};

/** Facts in minor units (cents); rendered as currency. */
export const MONEY_FACTS: ReadonlySet<FactName> = new Set([
  'request.candidateAmountMinor',
  'order.refundedOrPendingMinor',
  'request.cumulativeOrderRefundMinor',
]);

export const REASON_LABELS: Record<RefundReason, string> = {
  DAMAGED: 'Damaged',
  WRONG_ITEM: 'Wrong item',
  NOT_AS_DESCRIBED: 'Not as described',
  CHANGED_MIND: 'Changed mind',
  OTHER: 'Other',
};

const COMPARISON_WORDS = {
  eq: 'is',
  neq: 'is not',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  // Single-value form only; lists are handled in describeFact.
  in: 'is',
  notIn: 'is not',
} as const;

export function describeCondition(condition: PolicyCondition, currency: string): string {
  if ('all' in condition) return condition.all.map((c) => wrap(c, currency)).join(' and ');
  if ('any' in condition) return condition.any.map((c) => wrap(c, currency)).join(' or ');
  if ('not' in condition) return `it is not the case that ${wrap(condition.not, currency)}`;
  return describeFact(condition, currency);
}

/** Parenthesises nested groups to preserve precedence. */
function wrap(condition: PolicyCondition, currency: string): string {
  const text = describeCondition(condition, currency);
  return 'all' in condition || 'any' in condition ? `(${text})` : text;
}

function describeFact({ fact, op, value }: FactCondition, currency: string): string {
  const booleanPhrases = BOOLEAN_FACT_PHRASES[fact];
  if (booleanPhrases && typeof value === 'boolean' && (op === 'eq' || op === 'neq')) {
    return booleanPhrases[String(op === 'eq' ? value : !value) as 'true' | 'false'];
  }
  const label = FACT_LABELS[fact];
  if (op === 'isNull') return `${label} is unknown`;

  if (Array.isArray(value)) {
    const items = (value as ReadonlyArray<number | string>).map((v) => formatValue(fact, v, currency));
    if (items.length === 1) return `${label} ${op === 'in' ? 'is' : 'is not'} ${items[0]}`;
    // "one of"/"none of" avoids ambiguity with the "and"/"or" joiners.
    return `${label} is ${op === 'in' ? 'one of' : 'none of'} ${items.join(', ')}`;
  }
  return `${label} ${COMPARISON_WORDS[op]} ${formatValue(fact, value as ComparisonValue, currency)}`;
}

function formatValue(fact: FactName, value: ComparisonValue, currency: string): string {
  if (fact === 'claim.reason') return `"${REASON_LABELS[value as RefundReason]}"`;
  if (MONEY_FACTS.has(fact) && typeof value === 'number') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100);
  }
  return typeof value === 'string' ? `"${value}"` : String(value);
}

const OUTCOME_LABELS: Record<PolicyOutcome, string> = {
  ALLOW: 'Approved',
  DENY: 'Denied',
  REVIEW: 'Needs review',
};

/** Public reasons safe to share before a decision; REVIEW and request rules are internal. */
export function customerPolicyNotes(policy: PolicyDocument): string[] {
  return [...new Set(policy.lineRules.filter((rule) => rule.outcome !== 'REVIEW').map((rule) => rule.publicReason))];
}

export const GENERATED_NOTICE =
  '<!-- GENERATED from refund-policy.yaml by `npm run policy:docs` (in backend/). Do not edit by hand. -->';

/** Deterministic (byte-identical for the same YAML) so tests can detect drift. */
export function renderPolicyMarkdown(policy: PolicyDocument): string {
  const effective = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(policy.effectiveFrom),
  );
  const order = policy.precedence.map((o) => OUTCOME_LABELS[o]).join(', then ');

  const lines = [
    GENERATED_NOTICE,
    '',
    '# Refund Policy',
    '',
    `Version **${policy.version}** · effective ${effective} · amounts in ${policy.currency}`,
    '',
    '## How decisions are made',
    '',
    `- A customer can give one of these reasons: ${policy.reasons.map((r) => REASON_LABELS[r]).join(', ')}.`,
    '- Each item in a request is checked against every item rule below.',
    `- If more than one rule applies to an item, the outcome is chosen in this order: ${order}.`,
    `- If no rule applies to an item, it is **${OUTCOME_LABELS[policy.defaultOutcome]}**: "${escapeCell(policy.defaultPublicReason)}"`,
    '- If every item is denied, the request is denied. Otherwise the whole-request rules are checked too.',
    '- If any item or whole-request rule needs review, a member of the team decides the whole request.',
    `- Requests that need review are answered within ${policy.reviewEtaBusinessDays} business days.`,
    '',
    '## Item rules',
    '',
    ...ruleTable(policy.lineRules, policy.currency),
    '',
    '## Whole-request rules',
    '',
    ...(policy.requestRules.length > 0 ? ruleTable(policy.requestRules, policy.currency) : ['_None._']),
    '',
  ];
  return lines.join('\n');
}

function ruleTable(rules: readonly PolicyRule[], currency: string): string[] {
  return [
    '| Rule | Applies when | Outcome | What the customer is told |',
    '| --- | --- | --- | --- |',
    ...rules.map(
      (rule) =>
        `| \`${rule.id}\` | ${escapeCell(describeCondition(rule.when, currency))} | ${OUTCOME_LABELS[rule.outcome]} | ${escapeCell(rule.publicReason)} |`,
    ),
  ];
}

function escapeCell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}
