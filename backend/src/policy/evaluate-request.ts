import { evaluateLine } from './evaluate-line.js';
import { evaluateRuleSet } from './evaluate-rule-set.js';
import type { FactValues } from './fact-vocabulary.js';
import { InvalidEvaluationInputError } from './invalid-evaluation-input.error.js';
import type { PolicyDocument } from './policy.schema.js';
import type { LineInput, RequestEvaluation, RequestHistoryFacts } from './policy-evaluation.types.js';

/**
 * Decides a whole refund request:
 *  1. Every line is decided on its own (ALLOW / DENY / REVIEW).
 *  2. All lines DENY → DENIED. Request rules are not consulted, so DENY beats REVIEW
 *     at request level too (e.g. a frequent requester with an expired order is denied).
 *  3. Otherwise request rules run on the ALLOW lines' amounts, plus what is already
 *     refunded or pending on the order (this closes the split-request loophole).
 *  4. A request-level DENY → DENIED. Any line REVIEW or request-level REVIEW → ESCALATED.
 *  5. Otherwise APPROVED for the ALLOW lines; DENY lines are reported as not refunded.
 * Amounts are integer minor units only.
 */
export function evaluateRequest(
  policy: PolicyDocument,
  lines: readonly LineInput[],
  history: RequestHistoryFacts,
): RequestEvaluation {
  assertValidInput(lines, history);

  const lineResults = lines.map((line) => evaluateLine(policy, line));
  const base = {
    policyVersion: policy.version,
    lines: lineResults,
  };

  if (lineResults.every((l) => l.outcome === 'DENY')) {
    return {
      ...base,
      status: 'DENIED',
      approvedAmountMinor: 0,
      requestRulesEvaluated: false,
      requestFacts: null,
      requestTrace: [],
      requestDecidingRuleId: null,
      escalationRuleIds: [],
    };
  }

  const candidateAmountMinor = lineResults
    .filter((l) => l.outcome === 'ALLOW')
    .reduce((sum, l) => sum + l.amountMinor, 0);
  const requestFacts: FactValues = {
    ...history,
    'request.candidateAmountMinor': candidateAmountMinor,
    'request.cumulativeOrderRefundMinor': candidateAmountMinor + history['order.refundedOrPendingMinor'],
  };
  const request = evaluateRuleSet(policy.requestRules, requestFacts, policy.precedence);
  const requestPart = {
    requestRulesEvaluated: true,
    requestFacts,
    requestTrace: request.trace,
    requestDecidingRuleId: request.decidingRuleId,
  };

  if (request.outcome === 'DENY') {
    return { ...base, ...requestPart, status: 'DENIED', approvedAmountMinor: 0, escalationRuleIds: [] };
  }

  const escalationRuleIds = [
    ...lineResults.filter((l) => l.outcome === 'REVIEW').map((l) => l.decidingRuleId ?? 'DEFAULT'),
    ...request.trace.filter((t) => t.matched && t.outcome === 'REVIEW').map((t) => t.ruleId),
  ];
  if (escalationRuleIds.length > 0) {
    return {
      ...base,
      ...requestPart,
      status: 'ESCALATED',
      approvedAmountMinor: 0,
      escalationRuleIds: [...new Set(escalationRuleIds)],
    };
  }

  return { ...base, ...requestPart, status: 'APPROVED', approvedAmountMinor: candidateAmountMinor, escalationRuleIds: [] };
}

function assertValidInput(lines: readonly LineInput[], history: RequestHistoryFacts): void {
  if (lines.length === 0) throw new InvalidEvaluationInputError('a request needs at least one line');
  const ids = new Set(lines.map((l) => l.lineId));
  if (ids.size !== lines.length) throw new InvalidEvaluationInputError('line ids must be unique');
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amountMinor) || l.amountMinor < 0) {
      throw new InvalidEvaluationInputError(`line ${l.lineId}: amountMinor must be a non-negative integer`);
    }
  }
  for (const [key, value] of Object.entries(history)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new InvalidEvaluationInputError(`${key} must be a non-negative integer`);
    }
  }
}
