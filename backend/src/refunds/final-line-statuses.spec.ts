import type { RequestEvaluation } from '../policy/policy-evaluation.types.js';
import { finalLineStatuses } from './final-line-statuses.js';

function evaluation(status: RequestEvaluation['status'], outcomes: ('ALLOW' | 'DENY' | 'REVIEW')[]): RequestEvaluation {
  return {
    policyVersion: 'v', status, approvedAmountMinor: 0, requestRulesEvaluated: true, requestFacts: null,
    requestTrace: [], requestDecidingRuleId: null, escalationRuleIds: [],
    lines: outcomes.map((outcome, i) => ({ lineId: `l${i}`, amountMinor: 1, facts: {}, outcome, decidingRuleId: null, publicReason: '', trace: [] })),
  };
}

describe('finalLineStatuses', () => {
  it('APPROVED: allowed lines refunded, denied lines not', () => {
    expect([...finalLineStatuses(evaluation('APPROVED', ['ALLOW', 'DENY'])).values()]).toEqual(['REFUNDED', 'NOT_REFUNDED']);
  });
  it('DENIED: nothing refunded', () => {
    expect([...finalLineStatuses(evaluation('DENIED', ['DENY', 'DENY'])).values()]).toEqual(['NOT_REFUNDED', 'NOT_REFUNDED']);
  });
  it('ESCALATED: every line waits for a person, even ones the rules allowed', () => {
    expect([...finalLineStatuses(evaluation('ESCALATED', ['ALLOW', 'REVIEW', 'DENY'])).values()]).toEqual(['UNDER_REVIEW', 'UNDER_REVIEW', 'UNDER_REVIEW']);
  });
});

describe('finalLineStatuses after the safety gate', () => {
  it('holds every line for review when the gate escalated a policy approval', () => {
    const e = { policyVersion: 'v', status: 'APPROVED', approvedAmountMinor: 1, requestRulesEvaluated: true, requestFacts: null, requestTrace: [], requestDecidingRuleId: null, escalationRuleIds: [],
      lines: [{ lineId: 'a', amountMinor: 1, facts: {}, outcome: 'ALLOW', decidingRuleId: null, publicReason: '', trace: [] }] } as const;
    expect([...finalLineStatuses(e as never, 'ESCALATED').values()]).toEqual(['UNDER_REVIEW']);
  });
});
