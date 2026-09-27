import type { FactValue, FactValues } from './fact-vocabulary.js';
import { MissingFactError } from './missing-fact.error.js';
import type { ComparisonValue, FactCondition, PolicyCondition } from './policy-condition.types.js';

/**
 * Evaluates a validated condition against facts.
 * Null semantics: every comparison against a null fact is false; only "isNull" matches null.
 * So "daysSinceDelivery > 30" is false for an undelivered item, and so is "<= 30".
 */
export function evaluateCondition(condition: PolicyCondition, facts: FactValues): boolean {
  if ('all' in condition) return condition.all.every((c) => evaluateCondition(c, facts));
  if ('any' in condition) return condition.any.some((c) => evaluateCondition(c, facts));
  if ('not' in condition) return !evaluateCondition(condition.not, facts);
  return compare(condition, facts);
}

function compare({ fact, op, value }: FactCondition, facts: FactValues): boolean {
  if (!Object.hasOwn(facts, fact) || facts[fact] === undefined) throw new MissingFactError(fact);
  const actual: FactValue = facts[fact] as FactValue;

  if (op === 'isNull') return actual === null;
  if (actual === null) return false;

  const expected = value as ComparisonValue;
  switch (op) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'in':
      return (expected as ReadonlyArray<number | string>).includes(actual as number | string);
    case 'notIn':
      return !(expected as ReadonlyArray<number | string>).includes(actual as number | string);
    case 'gt':
      return (actual as number) > (expected as number);
    case 'gte':
      return (actual as number) >= (expected as number);
    case 'lt':
      return (actual as number) < (expected as number);
    case 'lte':
      return (actual as number) <= (expected as number);
  }
}
