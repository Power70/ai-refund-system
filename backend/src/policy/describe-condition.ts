import { BOOLEAN_FACT_PHRASES, FACT_LABELS, MONEY_FACTS, REASON_LABELS } from './fact-labels.js';
import type { FactName } from './fact-vocabulary.js';
import type { ComparisonValue, FactCondition, PolicyCondition } from './policy-condition.types.js';
import type { RefundReason } from './refund-reasons.js';

const COMPARISON_WORDS = {
  eq: 'is',
  neq: 'is not',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  // Lists are handled separately; these only apply to a single value.
  in: 'is',
  notIn: 'is not',
} as const;

/** Renders a validated condition as a plain-English phrase, e.g. "days since delivery is more than 30". */
export function describeCondition(condition: PolicyCondition, currency: string): string {
  if ('all' in condition) return condition.all.map((c) => wrap(c, currency)).join(' and ');
  if ('any' in condition) return condition.any.map((c) => wrap(c, currency)).join(' or ');
  if ('not' in condition) return `it is not the case that ${wrap(condition.not, currency)}`;
  return describeFact(condition, currency);
}

/** Parenthesise nested groups so "A and (B or C)" keeps its meaning. */
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
    // "one of" / "none of" keeps lists unambiguous next to "and"/"or".
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
