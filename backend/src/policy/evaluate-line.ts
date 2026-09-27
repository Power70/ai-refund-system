import { evaluateRuleSet } from './evaluate-rule-set.js';
import type { PolicyDocument } from './policy.schema.js';
import type { LineEvaluation, LineInput } from './policy-evaluation.types.js';

/** Decides one requested item. If no rule matches, the policy's (fail-safe) default applies. */
export function evaluateLine(policy: PolicyDocument, line: LineInput): LineEvaluation {
  const result = evaluateRuleSet(policy.lineRules, line.facts, policy.precedence);
  const rule = result.decidingRuleId ? policy.lineRules.find((r) => r.id === result.decidingRuleId) : undefined;

  return {
    ...line,
    outcome: result.outcome ?? policy.defaultOutcome,
    decidingRuleId: result.decidingRuleId,
    publicReason: rule?.publicReason ?? policy.defaultPublicReason,
    trace: result.trace,
  };
}
