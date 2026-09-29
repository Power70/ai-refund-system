import type { FactValues, PolicyOutcome, FactValue, ComparisonValue, FactCondition, PolicyCondition, PolicyRule, PolicyDocument } from './policy-schema.js';

/** Programming error: a rule referenced a fact the fact builder did not supply. */
export class MissingFactError extends Error {
  constructor(readonly fact: string) {
    super(`Fact "${fact}" was not provided to the policy evaluator`);
    this.name = 'MissingFactError';
  }
}

/** Programming error: malformed input from the caller. */
export class InvalidEvaluationInputError extends Error {
  constructor(message: string) {
    super(`Invalid policy evaluation input: ${message}`);
    this.name = 'InvalidEvaluationInputError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rounded down; fixed 24h days, so no DST effects. */
export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/** Recorded for every rule, matched or not, for the audit trail. */
export interface RuleTraceEntry {
  ruleId: string;
  outcome: PolicyOutcome;
  matched: boolean;
}

export interface RuleSetResult {
  trace: RuleTraceEntry[];
  /** Null when nothing matched. */
  outcome: PolicyOutcome | null;
  /** First matched rule in file order with the winning outcome. */
  decidingRuleId: string | null;
}

export interface LineInput {
  lineId: string;
  /** Minor units (cents), from the DB. */
  amountMinor: number;
  facts: FactValues;
}

export interface LineEvaluation extends LineInput {
  outcome: PolicyOutcome;
  /** Null when the policy default applied. */
  decidingRuleId: string | null;
  publicReason: string;
  trace: RuleTraceEntry[];
}

/** Caller-supplied request facts; the engine derives the rest. */
export interface RequestHistoryFacts {
  'order.refundedOrPendingMinor': number;
  'customer.requestsLast30Days': number;
}

export type PolicyStatus = 'APPROVED' | 'DENIED' | 'ESCALATED';

export interface RequestEvaluation {
  policyVersion: string;
  /** Pre-gate status; APPROVED may still be escalated by the safety gate. */
  status: PolicyStatus;
  /** Sum of ALLOW lines when APPROVED, otherwise 0. */
  approvedAmountMinor: number;
  lines: LineEvaluation[];
  /** False when every line was denied. */
  requestRulesEvaluated: boolean;
  requestFacts: FactValues | null;
  requestTrace: RuleTraceEntry[];
  requestDecidingRuleId: string | null;
  /** REVIEW rule ids, or "DEFAULT" for unmatched lines. */
  escalationRuleIds: string[];
}

/** Any comparison against a null fact is false; only "isNull" matches null. */
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

export function pickByPrecedence(
  outcomes: readonly PolicyOutcome[],
  precedence: readonly PolicyOutcome[],
): PolicyOutcome | null {
  for (const candidate of precedence) {
    if (outcomes.includes(candidate)) return candidate;
  }
  return null;
}

/** Evaluates every rule without short-circuiting so the audit trace is complete. */
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

/** Falls back to the policy's fail-safe default when no rule matches. */
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

/**
 * All lines DENY → DENIED without consulting request rules. Otherwise request rules see the
 * ALLOW amount plus what is already refunded or pending on the order (prevents split requests).
 * Request DENY → DENIED; any REVIEW → ESCALATED; else APPROVED. Amounts are integer minor units.
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
