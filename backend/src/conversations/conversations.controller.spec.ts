import { NotFoundException } from '@nestjs/common';
import { ConversationsController } from './conversations.controller.js';
import type { ConversationsService } from './conversations.service.js';
import type { ConversationViewDto, SendMessageDto } from './dto/conversations.dto.js';

const view = { conversationId: 'c0000000-0000-4000-8000-000000000001' } as ConversationViewDto;

function setup() {
  const conversations = { start: vi.fn(async () => view), view: vi.fn(async () => view as ConversationViewDto | null), send: vi.fn(async () => view) };
  return { conversations, controller: new ConversationsController(conversations as unknown as ConversationsService) };
}

describe('ConversationsController', () => {
  it('starts a conversation for the signed-in customer', async () => {
    const { conversations, controller } = setup();
    await expect(controller.start('cust-1')).resolves.toBe(view);
    expect(conversations.start).toHaveBeenCalledWith('cust-1');
  });

  it("404s for another customer's conversation", async () => {
    const { conversations, controller } = setup();
    conversations.view.mockResolvedValue(null);
    await expect(controller.get('cust-1', view.conversationId)).rejects.toThrow(NotFoundException);
    expect(conversations.view).toHaveBeenCalledWith('cust-1', view.conversationId);
  });

  it('sends a message on behalf of the signed-in customer', async () => {
    const { conversations, controller } = setup();
    const body = { clientMessageId: 'm1', text: 'hello' } as SendMessageDto;
    await controller.send('cust-1', view.conversationId, body);
    expect(conversations.send).toHaveBeenCalledWith('cust-1', view.conversationId, body);
  });
});
