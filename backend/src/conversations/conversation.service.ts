import { HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { LlmService } from '../ai/llm.service.js';
import { DATABASE, type Database } from '../database/database.js';
import { aiCalls, conversationMessages, conversations, customers, orderItems, orders, refundRequests, type ConversationFlags } from '../database/schema.js';
import { loadItemQuantities } from '../orders/item-quantities.js';
import { REASON_LABELS } from '../policy/policy-schema.js';
import { assistantTurnSchema, buildTurnPrompt, type ChatContext, type ContextOrder, sanitizeText, verifyTurn, type ProposalRecord, type QuickReply } from './chat-turn.js';
import type { ConversationViewDto, SendMessageDto } from './conversations.dto.js';
import { answerFollowUp, loadDecisionBrief } from '../refunds/refund-messages.js';

export const MAX_AI_TURNS = 6;
export const MAX_FOLLOW_UPS = 10;
export const MAX_FAILED_TURNS = 2;
export const MAX_CONVERSATIONS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
// A pending turn older than this is treated as abandoned (process crash) and may be replaced.
const PENDING_STALE_MS = 60_000;

const MESSAGES = {
  greetingAi: (firstName: string) => `Hi ${firstName}, I can help with a refund. Tell me what happened, or pick an item from your orders.`,
  greetingManual: (firstName: string) => `Hi ${firstName}, choose the item, quantity and reason in the form below and we'll take it from there.`,
  manual: 'Please use the form below to choose the item, quantity and reason.',
  aiFailed: "Sorry, I didn't quite get that. Which item is this about, and what went wrong?",
  handover: "Let's fill this in directly. Choose the item, quantity and reason in the form below.",
  stillProcessing: "We're still checking your request. The result will appear here shortly.",
  followUpLimit: (requestId: string) => `For further questions, please contact our support team and quote your request ID ${requestId}.`,
};

export type ConversationErrorCode = 'CONVERSATION_LIMIT' | 'CONVERSATION_CLOSED' | 'MESSAGE_IN_PROGRESS' | 'INVALID_MESSAGE';

const ERROR_STATUS: Record<ConversationErrorCode, HttpStatus> = {
  CONVERSATION_LIMIT: HttpStatus.TOO_MANY_REQUESTS,
  CONVERSATION_CLOSED: HttpStatus.CONFLICT,
  MESSAGE_IN_PROGRESS: HttpStatus.CONFLICT,
  INVALID_MESSAGE: HttpStatus.BAD_REQUEST,
};

export class ConversationException extends HttpException {
  constructor(readonly code: ConversationErrorCode, message: string) {
    super({ statusCode: ERROR_STATUS[code], code, message }, ERROR_STATUS[code]);
  }
}

interface AssistantStructured {
  replyTo: string | null;
  quickReplies: QuickReply[];
  proposalRejection?: string | null;
  replySource: 'AI' | 'TEMPLATE';
}

interface TurnOutcome {
  reply: string;
  structured: AssistantStructured;
  conversation: Partial<typeof conversations.$inferInsert>;
  aiCall: Omit<typeof aiCalls.$inferInsert, 'conversationId'> | null;
}

type ConversationRow = typeof conversations.$inferSelect;

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly llm: LlmService,
  ) {}

  async start(customerId: string, now = new Date()): Promise<ConversationViewDto> {
    const [{ recent }] = await this.db
      .select({ recent: sql<number>`count(*)::int` })
      .from(conversations)
      .where(and(eq(conversations.customerId, customerId), gte(conversations.createdAt, new Date(now.getTime() - DAY_MS))));
    if (recent >= MAX_CONVERSATIONS_PER_DAY) throw new ConversationException('CONVERSATION_LIMIT', 'Too many conversations today. Please try again tomorrow.');

    const [customer] = await this.db.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
    const firstName = customer?.name.split(' ')[0] ?? 'there';
    const mode = this.llm.enabled ? 'AI' : 'MANUAL';

    const id = await this.db.transaction(async (tx) => {
      const [conversation] = await tx.insert(conversations).values({ customerId, mode, handoverReason: mode === 'MANUAL' ? 'AI_DISABLED' : null, createdAt: now, updatedAt: now }).returning({ id: conversations.id });
      const structured: AssistantStructured = { replyTo: null, quickReplies: [], replySource: 'TEMPLATE' };
      const greeting = mode === 'AI' ? MESSAGES.greetingAi(firstName) : MESSAGES.greetingManual(firstName);
      await tx.insert(conversationMessages).values({ conversationId: conversation.id, role: 'ASSISTANT', content: greeting, structured, createdAt: now });
      return conversation.id;
    });
    return (await this.view(customerId, id))!;
  }

  /** The customer's conversation, or null (also for another customer's). */
  async view(customerId: string, conversationId: string): Promise<ConversationViewDto | null> {
    const [row] = await this.db
      .select({ conversation: conversations, requestId: refundRequests.publicId })
      .from(conversations)
      .leftJoin(refundRequests, eq(refundRequests.conversationId, conversations.id))
      .where(and(eq(conversations.id, conversationId), eq(conversations.customerId, customerId)));
    if (!row) return null;
    const { conversation } = row;

    const messages = await this.db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.role));
    const lastAssistant = messages.findLast((m) => m.role === 'ASSISTANT');
    const proposal = conversation.latestProposal as ProposalRecord | null;

    return {
      conversationId: conversation.id,
      state: conversation.state,
      mode: conversation.mode,
      requestId: row.requestId,
      messages: messages.map((m) => ({ id: m.id, role: m.role, text: m.content, createdAt: m.createdAt.toISOString() })),
      quickReplies: conversation.mode === 'AI' ? ((lastAssistant?.structured as AssistantStructured | null)?.quickReplies ?? []) : [],
      proposal: proposal ? { orderId: proposal.orderId, orderNumber: proposal.orderNumber, reason: proposal.reason, lines: proposal.lines } : null,
    };
  }

  async send(customerId: string, conversationId: string, input: SendMessageDto): Promise<ConversationViewDto> {
    const accepted = await this.acceptCustomerMessage(customerId, conversationId, input);
    if (accepted.kind === 'replay') return (await this.view(customerId, conversationId))!;

    let outcome: TurnOutcome;
    try {
      outcome = await this.computeTurn(customerId, accepted.conversation);
    } catch (error) {
      await this.db.update(conversations).set({ pendingSince: null }).where(eq(conversations.id, conversationId));
      throw error;
    }

    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.insert(conversationMessages).values({
        conversationId,
        role: 'ASSISTANT',
        content: outcome.reply,
        structured: { ...outcome.structured, replyTo: accepted.messageId },
        createdAt: now,
      });
      await tx.update(conversations).set({ ...outcome.conversation, pendingSince: null, updatedAt: now }).where(eq(conversations.id, conversationId));
      if (outcome.aiCall) await tx.insert(aiCalls).values({ ...outcome.aiCall, conversationId });
    });
    return (await this.view(customerId, conversationId))!;
  }

  /** Stores the customer message and marks the conversation busy, or detects a retry. */
  private async acceptCustomerMessage(customerId: string, conversationId: string, input: SendMessageDto) {
    const inputs = [input.text, input.orderItemId, input.reason, input.answer].filter((v) => v !== undefined);
    if (inputs.length !== 1) throw new ConversationException('INVALID_MESSAGE', 'Send either text or one selection.');

    return this.db.transaction(async (tx) => {
      const [conversation] = await tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.customerId, customerId)))
        .for('update');
      if (!conversation) throw new NotFoundException('Conversation not found.');

      const [existing] = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.clientMessageId, input.clientMessageId)));
      if (existing) {
        const [answered] = await tx
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(and(eq(conversationMessages.conversationId, conversationId), sql`${conversationMessages.structured}->>'replyTo' = ${existing.id}`));
        if (answered) return { kind: 'replay' as const };
        throw new ConversationException('MESSAGE_IN_PROGRESS', 'This message is still being answered.');
      }

      if (conversation.state === 'CLOSED') throw new ConversationException('CONVERSATION_CLOSED', 'This conversation is closed. Start a new one for another issue.');
      const now = new Date();
      if (conversation.pendingSince && now.getTime() - conversation.pendingSince.getTime() < PENDING_STALE_MS) {
        throw new ConversationException('MESSAGE_IN_PROGRESS', 'Please wait for the reply to your previous message.');
      }

      const message = await this.describeInput(tx, customerId, input);
      const [inserted] = await tx
        .insert(conversationMessages)
        .values({ conversationId, role: 'CUSTOMER', content: message.content, typed: message.typed, clientMessageId: input.clientMessageId, structured: message.selection, createdAt: now })
        .returning({ id: conversationMessages.id });

      const discussed = message.itemId && !conversation.discussedItemIds.includes(message.itemId) ? [...conversation.discussedItemIds, message.itemId] : conversation.discussedItemIds;
      const [updated] = await tx
        .update(conversations)
        .set({ pendingSince: now, discussedItemIds: discussed, updatedAt: now })
        .where(eq(conversations.id, conversationId))
        .returning();
      return { kind: 'accepted' as const, messageId: inserted.id, conversation: updated };
    });
  }

  private async describeInput(tx: Database, customerId: string, input: SendMessageDto) {
    if (input.text !== undefined) {
      const content = sanitizeText(input.text);
      if (!content) throw new ConversationException('INVALID_MESSAGE', 'Message is empty.');
      return { content, typed: true, selection: null, itemId: null };
    }
    if (input.orderItemId !== undefined) {
      const [item] = await tx
        .select({ name: orderItems.name })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(and(eq(orderItems.id, input.orderItemId), eq(orders.customerId, customerId)));
      if (!item) throw new NotFoundException('Item not found.');
      return { content: item.name, typed: false, selection: { kind: 'ITEM', orderItemId: input.orderItemId }, itemId: input.orderItemId };
    }
    if (input.reason !== undefined) {
      return { content: REASON_LABELS[input.reason], typed: false, selection: { kind: 'REASON', reason: input.reason }, itemId: null };
    }
    return { content: input.answer ? 'Yes' : 'No', typed: false, selection: { kind: 'YES_NO', value: input.answer }, itemId: null };
  }

  private async computeTurn(customerId: string, conversation: ConversationRow): Promise<TurnOutcome> {
    const template = (reply: string, changes: TurnOutcome['conversation'] = {}): TurnOutcome => ({
      reply,
      structured: { replyTo: null, quickReplies: [], replySource: 'TEMPLATE' },
      conversation: changes,
      aiCall: null,
    });

    if (conversation.state === 'SUBMITTED') return this.followUp(conversation, template);
    if (conversation.mode === 'MANUAL') return template(MESSAGES.manual);
    if (conversation.turnCount >= MAX_AI_TURNS) return template(MESSAGES.handover, { mode: 'MANUAL', handoverReason: 'TURN_LIMIT' });

    const context = await this.loadContext(customerId, conversation.id);
    const { system, user } = buildTurnPrompt(context);
    const result = await this.llm.generateStructured({
      name: 'record_turn',
      description: 'Record your reply to the customer and, when the claim is clear, the proposed claim.',
      system,
      user,
      schema: assistantTurnSchema,
    });
    const { provider, model } = this.llm.report();
    const call = { kind: 'CHAT_TURN' as const, provider, model, attempts: result.attempts, latencyMs: result.latencyMs };

    if (!result.ok) {
      this.logger.warn(`Chat turn failed for conversation ${conversation.id}: ${result.reason}`);
      const failedTurns = conversation.failedTurns + 1;
      const handover = result.reason === 'disabled' || failedTurns >= MAX_FAILED_TURNS;
      const outcome = template(handover ? MESSAGES.handover : MESSAGES.aiFailed, {
        failedTurns,
        turnCount: conversation.turnCount + 1,
        ...(handover ? { mode: 'MANUAL' as const, handoverReason: result.reason === 'disabled' ? 'AI_DISABLED' : 'AI_FAILED' } : {}),
      });
      outcome.aiCall = { ...call, outcome: aiOutcome(result.reason), failureReason: result.reason };
      return outcome;
    }

    const typed = context.transcript.filter((m) => m.role === 'CUSTOMER' && m.typed).map((m) => m.content);
    const verified = verifyTurn(result.value, context, typed);
    return {
      reply: verified.reply,
      structured: { replyTo: null, quickReplies: verified.quickReplies, proposalRejection: verified.proposalRejection, replySource: verified.replySource },
      conversation: {
        turnCount: conversation.turnCount + 1,
        failedTurns: 0,
        flags: mergeFlags(conversation.flags, verified.flags),
        discussedItemIds: [...new Set([...conversation.discussedItemIds, ...verified.discussedItemIds])],
        ...(verified.proposal ? { latestProposal: verified.proposal } : {}),
      },
      aiCall: {
        ...call,
        outcome: 'OK',
        validatedOutput: result.value,
        failureReason: verified.proposalRejection,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    };
  }

  /** After submission the chat answers questions about the decision, grounded in stored facts. */
  private async followUp(conversation: ConversationRow, template: (reply: string) => TurnOutcome): Promise<TurnOutcome> {
    const [request] = await this.db
      .select({ id: refundRequests.id, publicId: refundRequests.publicId, createdAt: refundRequests.createdAt })
      .from(refundRequests)
      .where(eq(refundRequests.conversationId, conversation.id));
    if (!request) return template(MESSAGES.manual);

    const brief = await loadDecisionBrief(this.db, request.id);
    if (!brief) return template(MESSAGES.stillProcessing);

    const questions = await this.db
      .select({ content: conversationMessages.content })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversation.id),
          eq(conversationMessages.role, 'CUSTOMER'),
          gte(conversationMessages.createdAt, request.createdAt),
        ),
      )
      .orderBy(asc(conversationMessages.createdAt));
    if (questions.length > MAX_FOLLOW_UPS) return template(MESSAGES.followUpLimit(request.publicId));

    const reply = await answerFollowUp(this.llm, brief, questions.at(-1)!.content);
    const outcome = template(reply.text);
    outcome.structured.replySource = reply.source;
    outcome.aiCall = reply.call ? { ...reply.call, kind: 'FOLLOW_UP', requestId: request.id } : null;
    return outcome;
  }

  private async loadContext(customerId: string, conversationId: string): Promise<ChatContext> {
    const rows = await this.db
      .select({ order: orders, item: orderItems })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(eq(orders.customerId, customerId))
      .orderBy(asc(orders.placedAt), asc(orderItems.name));
    const quantities = await loadItemQuantities(this.db, rows.map((r) => r.item.id));

    const byOrder = new Map<string, ContextOrder>();
    for (const { order, item } of rows) {
      let entry = byOrder.get(order.id);
      if (!entry) {
        entry = { ref: `O${byOrder.size + 1}`, orderId: order.id, orderNumber: order.orderNumber, deliveredAt: order.deliveredAt, items: [] };
        byOrder.set(order.id, entry);
      }
      const q = quantities.get(item.id);
      entry.items.push({
        ref: `${entry.ref}.I${entry.items.length + 1}`,
        orderItemId: item.id,
        name: item.name,
        purchased: item.quantity,
        refundable: q?.refundable ?? 0,
        pending: q?.pending ?? 0,
      });
    }

    const transcript = await this.db
      .select({ role: conversationMessages.role, content: conversationMessages.content, typed: conversationMessages.typed })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.role));
    return { orders: [...byOrder.values()], transcript };
  }
}

function mergeFlags(current: ConversationFlags, next: ConversationFlags): ConversationFlags {
  return {
    injectionAttempt: current.injectionAttempt || next.injectionAttempt,
    mentionsOtherCustomerOrder: current.mentionsOtherCustomerOrder || next.mentionsOtherCustomerOrder,
    abusive: current.abusive || next.abusive,
    offTopic: current.offTopic || next.offTopic,
  };
}

function aiOutcome(reason: string): 'INVALID' | 'TIMEOUT' | 'ERROR' | 'SKIPPED' {
  if (reason === 'invalid_output') return 'INVALID';
  if (reason === 'timeout') return 'TIMEOUT';
  if (reason === 'disabled') return 'SKIPPED';
  return 'ERROR';
}
