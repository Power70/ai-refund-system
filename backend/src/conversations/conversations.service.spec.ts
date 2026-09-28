import type { LlmService } from '../ai/llm.service.js';
import type { StructuredResult } from '../ai/llm.types.js';
import type { Database } from '../database/database.providers.js';
import type { conversations } from '../database/schema.js';
import type { OrdersService } from '../orders/orders.service.js';
import type { CustomerMessagesService } from '../refunds/customer-messages.service.js';
import type { AssistantTurn, ChatContext } from './chat-turn.js';
import { ConversationsService, MAX_AI_TURNS, MAX_FAILED_TURNS } from './conversations.service.js';

type ConversationRow = typeof conversations.$inferSelect;
const NO_FLAGS = { injectionAttempt: false, mentionsOtherCustomerOrder: false, abusive: false, offTopic: false };

const conversation = (overrides: Partial<ConversationRow> = {}) =>
  ({ id: 'conv-1', state: 'ACTIVE', mode: 'AI', turnCount: 0, failedTurns: 0, flags: NO_FLAGS, discussedItemIds: [], latestProposal: null, ...overrides }) as ConversationRow;

const context: ChatContext = {
  orders: [{ ref: 'O1', orderId: 'order-1', orderNumber: 'WN-7K3P9Q', deliveredAt: new Date(), items: [{ ref: 'O1.I1', orderItemId: 'item-1', name: 'Oxford shirt', purchased: 1, refundable: 1, pending: 0 }] }],
  transcript: [{ role: 'CUSTOMER', content: 'my shirt arrived torn', typed: true }],
};
const turn = (overrides: Partial<AssistantTurn> = {}): AssistantTurn => ({
  reply: 'Sorry to hear that. Which item is it?', quickReplies: [{ kind: 'ITEM', itemRef: 'O1.I1' }], needsClarification: true, proposal: null, flags: NO_FLAGS, summary: 'Torn shirt.', ...overrides,
});

class TestConversationsService extends ConversationsService {
  loadContext = vi.fn(async () => context);
  followUp = vi.fn(async (_conversation: ConversationRow, template: (reply: string) => Awaited<ReturnType<ConversationsService['computeTurn']>>) => template('follow-up'));
  turnFor(row: ConversationRow) {
    return this.computeTurn('cust-1', row);
  }
}

function setup(result: StructuredResult<AssistantTurn> = { ok: true, value: turn(), attempts: 1, latencyMs: 10 }) {
  const llm = {
    enabled: true,
    generateStructured: vi.fn(async () => result),
    callRecord: vi.fn((r: StructuredResult<unknown>, failureReason: string | null = null) => ({ provider: 'p', model: 'm', outcome: r.ok ? 'OK' : 'ERROR', attempts: 1, latencyMs: 10, failureReason })),
  };
  const service = new TestConversationsService({} as Database, llm as unknown as LlmService, {} as OrdersService, {} as CustomerMessagesService);
  return { service, llm };
}
const failed = (reason: 'timeout' | 'disabled'): StructuredResult<AssistantTurn> => ({ ok: false, reason, attempts: 2, latencyMs: 10 });

describe('ConversationsService turns', () => {
  it('rejects a message carrying more than one input before touching the database', async () => {
    await expect(setup().service.send('cust-1', 'conv-1', { clientMessageId: 'x', text: 'hi', reason: 'DAMAGED' })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
  });

  it('keeps a verified AI reply, its chips and the items discussed', async () => {
    const outcome = await setup().service.turnFor(conversation());
    expect(outcome.reply).toBe('Sorry to hear that. Which item is it?');
    expect(outcome.structured).toMatchObject({ replySource: 'AI', quickReplies: [{ kind: 'ITEM', orderItemId: 'item-1', label: 'Oxford shirt' }] });
    expect(outcome.conversation).toMatchObject({ turnCount: 1, failedTurns: 0, discussedItemIds: ['item-1'] });
    expect(outcome.aiCall).toMatchObject({ kind: 'CHAT_TURN', outcome: 'OK' });
  });

  it('keeps earlier flags once raised', async () => {
    const outcome = await setup().service.turnFor(conversation({ flags: { ...NO_FLAGS, injectionAttempt: true } }));
    expect(outcome.conversation.flags).toMatchObject({ injectionAttempt: true });
  });

  it('asks again after one failed AI turn', async () => {
    const outcome = await setup(failed('timeout')).service.turnFor(conversation());
    expect(outcome.conversation).toEqual({ failedTurns: 1, turnCount: 1 });
    expect(outcome.structured.replySource).toBe('TEMPLATE');
  });

  it(`hands over to the form after ${MAX_FAILED_TURNS} failed turns`, async () => {
    const outcome = await setup(failed('timeout')).service.turnFor(conversation({ failedTurns: MAX_FAILED_TURNS - 1 }));
    expect(outcome.conversation).toMatchObject({ mode: 'MANUAL', handoverReason: 'AI_FAILED' });
  });

  it('hands over at once when AI is disabled', async () => {
    const outcome = await setup(failed('disabled')).service.turnFor(conversation());
    expect(outcome.conversation).toMatchObject({ mode: 'MANUAL', handoverReason: 'AI_DISABLED' });
  });

  it(`stops calling the model after ${MAX_AI_TURNS} turns`, async () => {
    const { service, llm } = setup();
    const outcome = await service.turnFor(conversation({ turnCount: MAX_AI_TURNS }));
    expect(outcome.conversation).toEqual({ mode: 'MANUAL', handoverReason: 'TURN_LIMIT' });
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });

  it('answers manual conversations with the form prompt, and submitted ones as follow-ups', async () => {
    const { service, llm } = setup();
    expect((await service.turnFor(conversation({ mode: 'MANUAL' }))).reply).toMatch(/form below/);
    expect((await service.turnFor(conversation({ state: 'SUBMITTED' }))).reply).toBe('follow-up');
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });
});
