import type { LlmService } from '../ai/llm.service.js';
import type { Database } from '../database/database.providers.js';
import type { refundRequests } from '../database/schema.js';
import { ReviewSummaryService } from './review-summary.service.js';

const request = (flags: { injectionAttempt: boolean } | null = null) =>
  ({
    id: 'req-1',
    reasonConfirmed: 'DAMAGED',
    claimContext: flags ? { conversationId: 'conv-1', handoverReason: null, discussedItemIds: [], flags: { ...flags, mentionsOtherCustomerOrder: false, abusive: false, offTopic: false }, priorFlaggedConversation: false } : null,
    aiProposal: null,
  }) as unknown as typeof refundRequests.$inferSelect;

class TestReviewSummaryService extends ReviewSummaryService {
  findTarget = vi.fn(async () => ({ request: request(), conversationId: 'conv-1', escalationReasons: ['HIGH_VALUE'] }) as Awaited<ReturnType<ReviewSummaryService['findTarget']>>);
  loadClaim = vi.fn(async () => ({ transcript: [{ role: 'CUSTOMER', content: 'It arrived <b>torn</b>' }], lines: [{ name: 'Oxford shirt', quantity: 1 }] }));
  store = vi.fn(async () => undefined);
}

function setup(enabled = true) {
  const llm = {
    enabled,
    report: vi.fn(() => ({ provider: 'anthropic', model: 'claude', status: 'ok', lastError: null })),
    generateStructured: vi.fn(async () => ({ ok: true, value: { summary: 's', suggestedAction: 'APPROVE', rationale: 'r' }, attempts: 1, latencyMs: 9 })),
    callRecord: vi.fn(() => ({ provider: 'anthropic', model: 'claude', outcome: 'OK', attempts: 1, latencyMs: 9 })),
  };
  return { llm, service: new TestReviewSummaryService({} as Database, llm as unknown as LlmService) };
}

describe('ReviewSummaryService', () => {
  it('writes a case note for an escalated chat claim, with customer text delimited', async () => {
    const { llm, service } = setup();
    await service.summarize('req-1');
    const user = (llm.generateStructured.mock.calls[0] as unknown as [{ user: string }])[0].user;
    expect(user).toContain('<conversation>\ncustomer: It arrived  b torn /b \n</conversation>');
    expect(user).toContain('Confirmed claim: DAMAGED: 1 x Oxford shirt');
    expect(user).toContain('Escalation reasons: HIGH_VALUE');
    expect(service.store).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-1', conversationId: 'conv-1', kind: 'ADMIN_SUMMARY', outcome: 'OK' }));
  });

  it('does nothing with AI disabled or when there is nothing to summarise', async () => {
    const disabled = setup(false);
    await disabled.service.summarize('req-1');
    expect(disabled.service.findTarget).not.toHaveBeenCalled();

    const { llm, service } = setup();
    service.findTarget.mockResolvedValue(null);
    await service.summarize('req-1');
    expect(llm.generateStructured).not.toHaveBeenCalled();
    expect(service.store).not.toHaveBeenCalled();
  });

  it('never sends a conversation flagged for injection to the model', async () => {
    const { llm, service } = setup();
    service.findTarget.mockResolvedValue({ request: request({ injectionAttempt: true }), conversationId: 'conv-1', escalationReasons: ['INJECTION_SUSPECTED'] });
    await service.summarize('req-1');
    expect(llm.generateStructured).not.toHaveBeenCalled();
    expect(service.store).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'SKIPPED', failureReason: 'INJECTION_FLAGGED' }));
  });

  it('never throws', async () => {
    const { service } = setup();
    service.loadClaim.mockRejectedValue(new Error('database gone'));
    await expect(service.summarize('req-1')).resolves.toBeUndefined();
  });
});
