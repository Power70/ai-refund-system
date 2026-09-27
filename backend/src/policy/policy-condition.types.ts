import type { FactName } from './fact-vocabulary.js';

export const CONDITION_OPERATORS = ['eq', 'neq', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'isNull'] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export type ComparisonValue = boolean | number | string | ReadonlyArray<number | string>;

/** Policy rules are immutable data: nothing may modify them after loading. */
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
