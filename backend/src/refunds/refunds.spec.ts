import type { PolicyStatus, RequestEvaluation } from '../policy/policy-engine.js';
import { applySafetyGate, finalLineStatuses, type ClaimAssessment, type GateInput } from './decide-request.js';
import { resolutionCustomerMessage, fillPlaceholders, isSafeCustomerReply, type DecisionBrief } from './refund-messages.js';
import { generatePublicRequestId } from './refund-requests.js';

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

describe('generatePublicRequestId', () => {
  it('matches the format the database enforces', () => {
    for (let i = 0; i < 1000; i++) expect(generatePublicRequestId()).toMatch(/^rr_[0-9a-hjkmnp-tv-z]{12}$/);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 10_000 }, generatePublicRequestId));
    expect(ids.size).toBe(10_000);
  });
});

const items = [
  { itemName: 'Linen shirt, blue', approve: true },
  { itemName: 'Linen shirt, white', approve: false },
];

describe('resolutionCustomerMessage', () => {
  it('states the approved total', () => {
    expect(resolutionCustomerMessage('APPROVED', items.map((i) => ({ ...i, approve: true })), 14000, 'USD')).toBe(
      'Our support team reviewed your request and approved your refund of $140.00.',
    );
  });

  it('names what was and was not approved', () => {
    expect(resolutionCustomerMessage('PARTIALLY_APPROVED', items, 8000, 'USD')).toBe(
      "Our support team reviewed your request and approved a refund of $80.00 for: Linen shirt, blue. We couldn't approve a refund for: Linen shirt, white.",
    );
  });

  it('declines without an amount', () => {
    expect(resolutionCustomerMessage('DENIED', items, 0, 'USD')).toBe("Our support team reviewed your request and wasn't able to approve a refund.");
  });
});

describe('isSafeCustomerReply and fillPlaceholders', () => {
  const brief = (overrides: Partial<DecisionBrief> = {}): DecisionBrief => ({
    requestId: 'rr_abcdefghjkmn',
    status: 'APPROVED',
    firstName: 'Ada',
    currency: 'USD',
    approvedAmountMinor: 4999,
    reviewEtaBusinessDays: 2,
    items: [{ name: 'Oxford shirt, blue', quantity: 1, refunded: true, publicReason: 'Damaged items within 30 days qualify.' }],
    reviewedBySupport: false,
    ...overrides,
  });
  const facts = 'quantity 1. Reason: "Damaged items within 30 days qualify."';
  const partial = brief({ items: [...brief().items, { name: 'Belt', quantity: 1, refunded: false, publicReason: 'Final-sale items are not refundable.' }] });

  it('accepts prose with the required placeholders and fills them from stored values', () => {
    const text = 'Hi {{customer_first_name}}, your refund of {{approved_amount}} for {{item_list}} is confirmed.';
    expect(isSafeCustomerReply(text, brief(), facts)).toBe(true);
    expect(fillPlaceholders(text, brief())).toBe('Hi Ada, your refund of $49.99 for Oxford shirt, blue is confirmed.');
  });

  it.each([
    ['a missing required placeholder', 'Hi {{customer_first_name}}, all done.', brief()],
    ['a placeholder not allowed for the status', 'Refund of {{approved_amount}} within {{review_eta}}.', brief()],
    ['an unknown placeholder', 'Refund of {{approved_amount}} ({{amount}}).', brief()],
    ['a currency symbol', 'Refund of {{approved_amount}}, about $50.', brief()],
    ['an invented number', 'Refund of {{approved_amount}} in 5 days.', brief()],
    ['a link', 'Refund of {{approved_amount}}. See www.example.com', brief()],
    ['internal words', 'Refund of {{approved_amount}} per our rules.', brief()],
    ['a full approval that sounds like a refusal', "Refund of {{approved_amount}}, but we couldn't do more.", brief()],
    ['a denial that sounds approved', 'Good news! {{reasons}}', brief({ status: 'DENIED' })],
    ['an escalation that states an outcome', 'Your item is eligible. Expect news in {{review_eta}}.', brief({ status: 'ESCALATED' })],
    ['an escalation that explains why', 'We will reply in {{review_eta}}. {{reasons}}', brief({ status: 'ESCALATED' })],
  ])('rejects %s', (_, text, b) => {
    expect(isSafeCustomerReply(text, b, facts)).toBe(false);
  });

  it('allows numbers that appear in the facts given to the model', () => {
    expect(isSafeCustomerReply('Refund of {{approved_amount}}; items within 30 days qualify.', brief(), facts)).toBe(true);
  });

  it('requires the denied items for a partial approval, and allows saying so', () => {
    expect(isSafeCustomerReply('Refund of {{approved_amount}}.', partial, facts)).toBe(false);
    expect(isSafeCustomerReply("Refund of {{approved_amount}}. We couldn't refund {{denied_items}}.", partial, facts)).toBe(true);
    expect(fillPlaceholders('{{denied_items}}', partial)).toBe('Belt');
  });

  it('follow-ups need no placeholders but may never promise to change the decision', () => {
    expect(isSafeCustomerReply('Items delivered within 30 days qualify.', brief(), facts, { followUp: true })).toBe(true);
    expect(isSafeCustomerReply('We can reconsider the decision.', brief(), facts, { followUp: true })).toBe(false);
    expect(isSafeCustomerReply('You could appeal this.', brief(), facts, { followUp: true })).toBe(false);
  });
});
