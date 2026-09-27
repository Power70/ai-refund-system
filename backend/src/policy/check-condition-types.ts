import { FACT_VOCABULARY, isFactName, type FactScope } from './fact-vocabulary.js';
import type { ConditionOperator } from './policy-condition.types.js';

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

/**
 * Walks a structurally valid condition tree and reports semantic problems:
 * unknown facts, facts from the wrong scope, operators that don't fit the fact's
 * type, and values of the wrong type (including reasons the policy doesn't offer).
 */
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
