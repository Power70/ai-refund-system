import { readFileSync } from 'node:fs';
import type { refundRequests } from '../database/schema.js';
import type { PolicyStatus, RequestEvaluation } from '../policy/policy-engine.js';
import { parsePolicy } from '../policy/policy-schema.js';
import type { RegisteredPolicy } from '../policy/policy.service.js';
import { applySafetyGate, finalLineStatuses, planDecision, type ClaimAssessment, type DecisionInput, type GateInput } from './decision.rules.js';

const cleanAi: ClaimAssessment = {
  kind: 'AI', proposedReason: 'DAMAGED', discussedItemIds: ['item-1', 'item-2'], confidence: 0.97,
  flags: { injectionSuspected: false, otherCustomerOrderMentioned: false, abusive: false },
};

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    policyStatus: 'APPROVED', confirmedReason: 'DAMAGED', confirmedItemIds: ['item-1'],
    assessment: cleanAi, priorFlaggedConversation: false, minConfidence: 0.95, ...overrides,
  };
}
const ai = (overrides: Partial<Extract<ClaimAssessment, { kind: 'AI' }>>) => ({ ...cleanAi, ...overrides }) as ClaimAssessment;
const flags = (f: Partial<Extract<ClaimAssessment, { kind: 'AI' }>['flags']>) => ai({ flags: { ...(cleanAi as Extract<ClaimAssessment, { kind: 'AI' }>).flags, ...f } });

describe('applySafetyGate', () => {
  it('keeps an approval when every check passes', () => {
    expect(applySafetyGate(input())).toEqual({ status: 'APPROVED', reasons: [] });
  });

  it.each([
    ['manual claim', { assessment: { kind: 'MANUAL' } }, 'NO_AI_ASSESSMENT'],
    ['AI unavailable', { assessment: { kind: 'AI_UNAVAILABLE' } }, 'AI_UNAVAILABLE'],
    ['reason changed on the card', { confirmedReason: 'CHANGED_MIND' }, 'REASON_OVERRIDDEN'],
    ['item never discussed', { confirmedItemIds: ['item-1', 'item-9'] }, 'ITEM_NOT_DISCUSSED'],
    ['injection suspected', { assessment: flags({ injectionSuspected: true }) }, 'INJECTION_SUSPECTED'],
    ["another customer's order mentioned", { assessment: flags({ otherCustomerOrderMentioned: true }) }, 'OTHER_CUSTOMER_ORDER_MENTIONED'],
    ['abusive', { assessment: flags({ abusive: true }) }, 'ABUSIVE'],
    ['flagged conversation in the last 30 days', { priorFlaggedConversation: true }, 'PRIOR_FLAGS'],
    ['confidence below the threshold', { assessment: ai({ confidence: 0.9499 }) }, 'LOW_CONFIDENCE'],
    ['confidence not a number', { assessment: ai({ confidence: Number.NaN }) }, 'LOW_CONFIDENCE'],
  ] as [string, Partial<GateInput>, string][])('escalates an approval when: %s', (_label, overrides, reason) => {
    expect(applySafetyGate(input(overrides))).toEqual({ status: 'ESCALATED', reasons: [reason] });
  });

  it('accepts confidence exactly at the threshold', () => {
    expect(applySafetyGate(input({ assessment: ai({ confidence: 0.95 }) })).status).toBe('APPROVED');
  });

  it('reports every failed check, not just the first', () => {
    const result = applySafetyGate(input({ confirmedReason: 'OTHER', assessment: ai({ confidence: 0.1 }), priorFlaggedConversation: true }));
    expect(result.reasons).toEqual(['REASON_OVERRIDDEN', 'LOW_CONFIDENCE', 'PRIOR_FLAGS']);
  });

  it.each(['DENIED', 'ESCALATED'] as PolicyStatus[])('never changes a %s decision, whatever the AI said', (status) => {
    const everythingWrong = input({ policyStatus: status, assessment: { kind: 'MANUAL' }, priorFlaggedConversation: true });
    expect(applySafetyGate(everythingWrong)).toEqual({ status, reasons: [] });
  });

  it('can never produce an approval the policy did not give (exhaustive over inputs)', () => {
    const assessments: ClaimAssessment[] = [{ kind: 'MANUAL' }, { kind: 'AI_UNAVAILABLE' }, cleanAi, ai({ confidence: 0 })];
    for (const policyStatus of ['APPROVED', 'DENIED', 'ESCALATED'] as PolicyStatus[])
      for (const assessment of assessments)
        for (const priorFlaggedConversation of [true, false]) {
          const { status } = applySafetyGate(input({ policyStatus, assessment, priorFlaggedConversation }));
          expect([policyStatus, 'ESCALATED']).toContain(status);
          if (policyStatus !== 'APPROVED') expect(status).toBe(policyStatus);
        }
  });
});

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

describe('planDecision', () => {
  const document = parsePolicy(readFileSync(new URL('../../../policy/refund-policy.yaml', import.meta.url), 'utf8'));
  const policy: RegisteredPolicy = { id: 'policy-1', version: document.version, contentHash: 'hash', effectiveFrom: new Date(document.effectiveFrom), document };
  const lineFacts = (overrides: Record<string, unknown> = {}) => ({
    'item.delivered': true,
    'item.daysSinceDelivery': 3,
    'item.finalSale': false,
    'item.category': 'APPAREL',
    'item.priorDeniedRequest': false,
    'claim.reason': 'DAMAGED',
    ...overrides,
  });
  const request = (overrides: Partial<typeof refundRequests.$inferSelect> = {}) =>
    ({ id: 'req-1', publicId: 'rr_abcdefghjkmn', reasonConfirmed: 'DAMAGED', claimContext: null, aiProposal: null, ...overrides }) as typeof refundRequests.$inferSelect;
  const input = (overrides: Partial<DecisionInput> = {}): DecisionInput => ({
    request: request(),
    lines: [{ orderItemId: 'item-1', quantity: 1 }],
    policy,
    facts: { lines: [{ lineId: 'item-1', amountMinor: 4999, facts: lineFacts() }], history: { 'order.refundedOrPendingMinor': 0, 'customer.requestsLast30Days': 0 } },
    customerName: 'Ada Okafor',
    currency: 'USD',
    itemNames: new Map([['item-1', 'Oxford shirt, blue']]),
    minConfidence: 0.95,
    ...overrides,
  });

  it('holds a manual claim the policy would approve for a person, with no amount and no reasons shown', () => {
    const plan = planDecision(input());
    expect(plan.evaluation.status).toBe('APPROVED');
    expect(plan.gate).toEqual({ status: 'ESCALATED', reasons: ['NO_AI_ASSESSMENT'] });
    expect(plan.approvedAmountMinor).toBe(0);
    expect(plan.statuses.get('item-1')).toBe('UNDER_REVIEW');
    expect(plan.brief).toMatchObject({ status: 'ESCALATED', firstName: 'Ada', items: [{ name: 'Oxford shirt, blue', refunded: null, publicReason: null }] });
  });

  it('approves a clean AI-assessed claim for the policy amount', () => {
    const assessed = request({
      claimContext: { conversationId: 'c1', handoverReason: null, discussedItemIds: ['item-1'], flags: null, priorFlaggedConversation: false },
      aiProposal: { orderId: 'o1', orderNumber: 'WN-7K3P9Q', reason: 'DAMAGED', lines: [], evidenceQuotes: ['it arrived torn'], confidence: 0.99 },
    });
    const plan = planDecision(input({ request: assessed }));
    expect(plan.gate.status).toBe('APPROVED');
    expect(plan.approvedAmountMinor).toBe(4999);
    expect(plan.brief.items[0]).toMatchObject({ refunded: true, quantity: 1 });
  });

  it.each([
    ['an approval', lineFacts(), 'APPROVED'],
    ['a denial', lineFacts({ 'item.daysSinceDelivery': 90 }), 'DENIED'],
  ])('sends %s for an order in another currency to a person', (_label, facts, policyStatus) => {
    const assessed = request({
      claimContext: { conversationId: 'c1', handoverReason: null, discussedItemIds: ['item-1'], flags: null, priorFlaggedConversation: false },
      aiProposal: { orderId: 'o1', orderNumber: 'WN-7K3P9Q', reason: 'DAMAGED', lines: [], evidenceQuotes: ['it arrived torn'], confidence: 0.99 },
    });
    const plan = planDecision(
      input({ request: assessed, currency: 'EUR', facts: { lines: [{ lineId: 'item-1', amountMinor: 4999, facts }], history: { 'order.refundedOrPendingMinor': 0, 'customer.requestsLast30Days': 0 } } }),
    );
    expect(plan.evaluation.status).toBe(policyStatus);
    expect(plan.gate).toEqual({ status: 'ESCALATED', reasons: ['CURRENCY_MISMATCH'] });
    expect(plan.approvedAmountMinor).toBe(0);
    expect(plan.statuses.get('item-1')).toBe('UNDER_REVIEW');
  });

  it('passes a policy denial through with its customer-facing reason', () => {
    const plan = planDecision(input({ facts: { ...input().facts, lines: [{ lineId: 'item-1', amountMinor: 4999, facts: lineFacts({ 'item.daysSinceDelivery': 45 }) }] } }));
    expect(plan.gate).toEqual({ status: 'DENIED', reasons: [] });
    expect(plan.brief.items[0].refunded).toBe(false);
    expect(plan.brief.items[0].publicReason).toBeTruthy();
  });
});
