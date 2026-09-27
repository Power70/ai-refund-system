import { evaluateCondition } from './evaluate-condition.js';
import type { FactValues } from './fact-vocabulary.js';
import { pickByPrecedence } from './pick-by-precedence.js';
import type { PolicyOutcome, PolicyRule } from './policy.schema.js';
import type { RuleSetResult } from './policy-evaluation.types.js';

/**
 * Evaluates every rule (no short-circuit, so the audit trace is complete) and
 * picks the winning outcome by precedence. The deciding rule is the first rule,
 * in file order, that matched with the winning outcome.
 */
export function evaluateRuleSet(
  rules: readonly PolicyRule[],
  facts: FactValues,
  precedence: readonly PolicyOutcome[],
): RuleSetResult {
  const trace = rules.map((rule) => ({
    ruleId: rule.id,
    outcome: rule.outcome,
    matched: evaluateCondition(rule.when, facts),
  }));
  const matched = trace.filter((entry) => entry.matched);
  const outcome = pickByPrecedence(matched.map((entry) => entry.outcome), precedence);
  const decidingRuleId = outcome ? (matched.find((entry) => entry.outcome === outcome)?.ruleId ?? null) : null;
  return { trace, outcome, decidingRuleId };
}
