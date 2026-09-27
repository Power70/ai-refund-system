import { and, eq, gte, inArray, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';
import { auditEvents, conversations, orderItems, orders, refundRequestLines, refundRequests } from '../../database/schema/index.js';
import { loadItemQuantities } from '../../orders/load-item-quantities.js';
import { findActivePolicy } from '../../policy/registry/find-active-policy.js';
import { NoActivePolicyError } from '../../policy/registry/no-active-policy.error.js';
import { generatePublicRequestId } from '../generate-public-request-id.js';
import type { ProposalRecord } from '../../conversations/verify-turn.js';
import type { ClaimContext } from './assessment-for-request.js';
import type { SubmitRefundRequestDto } from './dto/submit-refund-request.dto.js';
import { IdempotentReplaySignal } from './idempotent-replay.signal.js';
import { newLease } from './new-lease.js';
import { RefundRequestException } from './refund-request.exception.js';

export interface ReservedRequest {
  requestId: string;
  leaseOwner: string;
}

/**
 * Transaction 1: validate the claim against the database and reserve the quantities.
 * The item rows are locked (SELECT … FOR UPDATE), so two simultaneous submissions for the
 * same item run one after the other and the second sees the first one's reservation.
 * Nothing slow (no AI) happens inside this transaction.
 */
export async function reserveRequest(
  db: Database,
  customerId: string,
  idempotencyKey: string,
  payloadHash: string,
  dto: SubmitRefundRequestDto,
  now = new Date(),
): Promise<ReservedRequest> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.orderNumber, dto.orderNumber), eq(orders.customerId, customerId)));
    if (!order) throw notFound();

    const itemIds = dto.lines.map((l) => l.itemId.toLowerCase());
    const items = await tx
      .select({ id: orderItems.id, unitPricePaidMinor: orderItems.unitPricePaidMinor })
      .from(orderItems)
      .where(and(inArray(orderItems.id, itemIds), eq(orderItems.orderId, order.id)))
      .orderBy(orderItems.id) // consistent lock order: no deadlocks between concurrent submissions
      .for('update');
    if (items.length !== itemIds.length) throw notFound();

    // While we waited for the locks, a simultaneous retry with the same key may have won:
    // that is the same claim, not a competing one, so answer with it (checked before quantities).
    const [sameKey] = await tx
      .select({ id: refundRequests.id })
      .from(refundRequests)
      .where(and(eq(refundRequests.customerId, customerId), eq(refundRequests.idempotencyKey, idempotencyKey)));
    if (sameKey) throw new IdempotentReplaySignal();

    const claim = await captureClaimContext(tx, customerId, dto.conversationId?.toLowerCase() ?? null, now);

    const quantities = await loadItemQuantities(tx, itemIds);
    for (const line of dto.lines) {
      const q = quantities.get(line.itemId.toLowerCase())!;
      if (line.quantity <= q.refundable) continue;
      if (q.refundable === 0 && q.pending > 0) {
        throw new RefundRequestException('ALREADY_IN_PROGRESS', 'A request for this item is already being processed or reviewed.');
      }
      if (q.refundable === 0) {
        throw new RefundRequestException('NOTHING_LEFT_TO_REFUND', 'This item has already been refunded.');
      }
      throw new RefundRequestException('QUANTITY_TOO_HIGH', `Only ${q.refundable} of this item can be refunded.`);
    }

    let policyVersionId: string;
    try {
      policyVersionId = (await findActivePolicy(tx, now)).id;
    } catch (error) {
      if (error instanceof NoActivePolicyError) throw new RefundRequestException('NO_ACTIVE_POLICY', 'Refunds are temporarily unavailable. Please try again later.');
      throw error;
    }

    const lease = newLease(now);
    const [request] = await tx
      .insert(refundRequests)
      .values({
        publicId: generatePublicRequestId(),
        customerId,
        orderId: order.id,
        policyVersionId,
        idempotencyKey,
        payloadHash,
        reasonConfirmed: dto.reason,
        conversationId: claim.context.conversationId,
        claimContext: claim.context,
        aiProposal: claim.proposal,
        reasonOverridden: claim.proposal !== null && claim.proposal.reason !== dto.reason,
        state: 'PROCESSING',
        ...lease,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: refundRequests.id });

    const priceById = new Map(items.map((i) => [i.id, i.unitPricePaidMinor]));
    await tx.insert(refundRequestLines).values(
      dto.lines.map((line) => ({
        requestId: request.id,
        orderId: order.id,
        orderItemId: line.itemId.toLowerCase(),
        quantity: line.quantity,
        amountMinor: priceById.get(line.itemId.toLowerCase())! * line.quantity,
      })),
    );

    await tx.insert(auditEvents).values({
      requestId: request.id,
      type: 'REQUEST_RECEIVED',
      actor: 'CUSTOMER',
      data: {
        reason: dto.reason,
        lines: dto.lines.map((l) => ({ itemId: l.itemId.toLowerCase(), quantity: l.quantity })),
        conversationId: claim.context.conversationId,
        proposedReason: claim.proposal?.reason ?? null,
      },
      createdAt: now,
    });

    return { requestId: request.id, leaseOwner: lease.leaseOwner };
  });
}

const FLAG_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Locks the conversation (if any), marks it submitted and snapshots what the gate needs.
 * The lock serialises two submissions from the same chat.
 */
async function captureClaimContext(tx: Database, customerId: string, conversationId: string | null, now: Date) {
  const flagged = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.customerId, customerId),
        gte(conversations.createdAt, new Date(now.getTime() - FLAG_LOOKBACK_MS)),
        conversationId ? ne(conversations.id, conversationId) : undefined,
        or(
          sql`(${conversations.flags}->>'injectionAttempt')::boolean`,
          sql`(${conversations.flags}->>'mentionsOtherCustomerOrder')::boolean`,
          sql`(${conversations.flags}->>'abusive')::boolean`,
        ),
      ),
    )
    .limit(1);
  const priorFlaggedConversation = flagged.length > 0;

  if (!conversationId) {
    const context: ClaimContext = { conversationId: null, handoverReason: null, discussedItemIds: [], flags: null, priorFlaggedConversation };
    return { context, proposal: null };
  }

  const [conversation] = await tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.customerId, customerId)))
    .for('update');
  if (!conversation) throw new RefundRequestException('ORDER_OR_ITEM_NOT_FOUND', "We couldn't find that conversation.");
  if (conversation.state !== 'ACTIVE') {
    throw new RefundRequestException('CONVERSATION_ALREADY_SUBMITTED', 'A claim was already submitted from this conversation.');
  }
  await tx.update(conversations).set({ state: 'SUBMITTED', updatedAt: now }).where(eq(conversations.id, conversationId));

  const context: ClaimContext = {
    conversationId,
    handoverReason: conversation.handoverReason as ClaimContext['handoverReason'],
    discussedItemIds: conversation.discussedItemIds,
    flags: conversation.flags,
    priorFlaggedConversation,
  };
  return { context, proposal: (conversation.latestProposal as ProposalRecord | null) ?? null };
}

function notFound(): RefundRequestException {
  return new RefundRequestException('ORDER_OR_ITEM_NOT_FOUND', "We couldn't find that item in your orders.");
}
