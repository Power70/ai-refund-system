import type { FactValues, PolicyOutcome, FactValue, ComparisonValue, FactCondition, PolicyCondition, PolicyRule, PolicyDocument } from './policy-schema.js';

/** A rule referenced a fact the fact builder didn't supply: a programming error, never a customer's fault. */
export class MissingFactError extends Error {
  constructor(readonly fact: string) {
    super(`Fact "${fact}" was not provided to the policy evaluator`);
    this.name = 'MissingFactError';
  }
}

/** The caller passed malformed input to the policy engine: a programming error, never a customer's fault. */
export class InvalidEvaluationInputError extends Error {
  constructor(message: string) {
    super(`Invalid policy evaluation input: ${message}`);
    this.name = 'InvalidEvaluationInputError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days elapsed from `from` to `to`, rounded down (UTC, no DST effects).
 * Day 30 of a 30-day window is day 30 until a full 31st day has passed.
 */
export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/** One rule's result, kept for the audit trail whether it matched or not. */
export interface RuleTraceEntry {
  ruleId: string;
  outcome: PolicyOutcome;
  matched: boolean;
}

export interface RuleSetResult {
  trace: RuleTraceEntry[];
  /** Winning outcome among matched rules, or null when nothing matched. */
  outcome: PolicyOutcome | null;
  /** First matched rule (in file order) carrying the winning outcome. */
  decidingRuleId: string | null;
}

export interface LineInput {
  lineId: string;
  /** Refund amount for this line in minor units, computed from the DB. */
  amountMinor: number;
  facts: FactValues;
}

export interface LineEvaluation extends LineInput {
  outcome: PolicyOutcome;
  /** null when no rule matched and the policy default applied. */
  decidingRuleId: string | null;
  publicReason: string;
  trace: RuleTraceEntry[];
}

/** Request-level facts supplied by the caller; the engine derives the rest. */
export interface RequestHistoryFacts {
  'order.refundedOrPendingMinor': number;
  'customer.requestsLast30Days': number;
}

export type PolicyStatus = 'APPROVED' | 'DENIED' | 'ESCALATED';

export interface RequestEvaluation {
  policyVersion: string;
  /** APPROVED here still has to pass the AI safety gate before it is final. */
  status: PolicyStatus;
  /** Sum of ALLOW lines when APPROVED, otherwise 0. */
  approvedAmountMinor: number;
  lines: LineEvaluation[];
  /** False when every line was denied, so request rules were never consulted. */
  requestRulesEvaluated: boolean;
  requestFacts: FactValues | null;
  requestTrace: RuleTraceEntry[];
  requestDecidingRuleId: string | null;
  /** Rule ids (or "DEFAULT") that sent the request to a person. */
  escalationRuleIds: string[];
}

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

/** Returns the outcome listed earliest in the policy's precedence, or null for an empty list. */
export function pickByPrecedence(
  outcomes: readonly PolicyOutcome[],
  precedence: readonly PolicyOutcome[],
): PolicyOutcome | null {
  for (const candidate of precedence) {
    if (outcomes.includes(candidate)) return candidate;
  }
  return null;
}

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
