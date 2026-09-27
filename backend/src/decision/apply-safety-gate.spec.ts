import type { PolicyStatus } from '../policy/policy-evaluation.types.js';
import { applySafetyGate } from './apply-safety-gate.js';
import type { ClaimAssessment, GateInput } from './safety-gate.types.js';

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
