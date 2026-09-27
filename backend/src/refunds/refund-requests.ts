import { HttpException, HttpStatus } from '@nestjs/common';
import { and, eq, gte, inArray, ne, or, sql, lt, desc } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { ProposalRecord } from '../conversations/chat-turn.js';
import type { Database } from '../database/database.js';
import { auditEvents, conversations, orderItems, orders, refundRequestLines, refundRequests, decisions, reviewResolutions } from '../database/schema.js';
import { loadItemQuantities } from '../orders/item-quantities.js';
import { findActivePolicy, NoActivePolicyError } from '../policy/policy-registry.js';
import type { ClaimContext } from './decide-request.js';
import type { SubmitRefundRequestDto, CustomerRequestViewDto } from './refunds.dto.js';

export type RefundRequestErrorCode =
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'ORDER_OR_ITEM_NOT_FOUND'
  | 'ALREADY_IN_PROGRESS'
  | 'NOTHING_LEFT_TO_REFUND'
  | 'QUANTITY_TOO_HIGH'
  | 'NO_ACTIVE_POLICY'
  | 'CONVERSATION_ALREADY_SUBMITTED';

const STATUS: Record<RefundRequestErrorCode, HttpStatus> = {
  IDEMPOTENCY_KEY_REQUIRED: HttpStatus.BAD_REQUEST,
  IDEMPOTENCY_KEY_REUSED: HttpStatus.CONFLICT,
  ORDER_OR_ITEM_NOT_FOUND: HttpStatus.NOT_FOUND,
  ALREADY_IN_PROGRESS: HttpStatus.CONFLICT,
  NOTHING_LEFT_TO_REFUND: HttpStatus.UNPROCESSABLE_ENTITY,
  QUANTITY_TOO_HIGH: HttpStatus.UNPROCESSABLE_ENTITY,
  NO_ACTIVE_POLICY: HttpStatus.SERVICE_UNAVAILABLE,
  CONVERSATION_ALREADY_SUBMITTED: HttpStatus.CONFLICT,
};

/** A refund request error with a stable code the frontend can act on, and a plain message. */
export class RefundRequestException extends HttpException {
  constructor(readonly code: RefundRequestErrorCode, message: string) {
    super({ statusCode: STATUS[code], code, message }, STATUS[code]);
  }
}

/**
 * Raised inside transaction 1 when, after waiting for the item locks, a request with the
 * same idempotency key turns out to exist (a simultaneous retry won). The caller answers
 * with that request instead of treating this retry as a competing claim.
 */
export class IdempotentReplaySignal extends Error {
  constructor() {
    super('A request with this idempotency key already exists');
    this.name = 'IdempotentReplaySignal';
  }
}

// Crockford base32, lower-case: no i, l, o, u, so IDs are easy to read out over the phone.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const LENGTH = 12;

/**
 * Customer-facing request ID, e.g. "rr_7k3p9qa2mx4d". 60 random bits from a CSPRNG:
 * not sequential, not guessable, and collisions are negligible (the column is unique anyway).
 */
export function generatePublicRequestId(): string {
  let id = 'rr_';
  for (let i = 0; i < LENGTH; i++) id += ALPHABET[randomInt(ALPHABET.length)];
  return id;
}

export const LEASE_MS = 60_000;

/** A unique owner id per processing attempt, and when the lease runs out. */
export function newLease(now = new Date()): { leaseOwner: string; leaseExpiresAt: Date } {
  return { leaseOwner: `${hostname()}:${process.pid}:${randomUUID()}`, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) };
}

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

/**
 * Takes over a request whose worker died (lease expired) with one compare-and-set UPDATE.
 * If two callers race (a retry and the sweeper), exactly one gets the lease; the other gets null.
 */
export async function reclaimExpiredLease(db: Database, requestId: string, now = new Date()): Promise<string | null> {
  const lease = newLease(now);
  const [row] = await db
    .update(refundRequests)
    .set({ ...lease, attemptCount: sql`${refundRequests.attemptCount} + 1`, updatedAt: now })
    .where(and(eq(refundRequests.id, requestId), eq(refundRequests.state, 'PROCESSING'), lt(refundRequests.leaseExpiresAt, now)))
    .returning({ attemptCount: refundRequests.attemptCount });
  if (!row) return null;
  await db.insert(auditEvents).values({ requestId, type: 'PROCESSING_RESUMED', actor: 'SYSTEM', data: { attempt: row.attemptCount }, createdAt: now });
  return lease.leaseOwner;
}

/**
 * The customer's view of one of their own requests, or null (also for someone else's).
 * A reviewer's resolution, when present, is the effective outcome.
 */
export async function loadCustomerRequestView(
  db: Database,
  customerId: string,
  where: { requestId: string } | { publicId: string },
): Promise<CustomerRequestViewDto | null> {
  const [row] = await db
    .select({ request: refundRequests, orderNumber: orders.orderNumber })
    .from(refundRequests)
    .innerJoin(orders, eq(orders.id, refundRequests.orderId))
    .where(
      and(
        eq(refundRequests.customerId, customerId),
        'requestId' in where ? eq(refundRequests.id, where.requestId) : eq(refundRequests.publicId, where.publicId),
      ),
    );
  if (!row) return null;
  const { request } = row;

  const [decision] = await db.select().from(decisions).where(eq(decisions.requestId, request.id));
  const [resolution] = await db.select().from(reviewResolutions).where(eq(reviewResolutions.requestId, request.id));
  const lines = await db
    .select({ quantity: refundRequestLines.quantity, status: refundRequestLines.finalLineStatus, name: orderItems.name })
    .from(refundRequestLines)
    .innerJoin(orderItems, eq(orderItems.id, refundRequestLines.orderItemId))
    .where(eq(refundRequestLines.requestId, request.id))
    .orderBy(orderItems.name);

  const status = resolution
    ? resolution.outcome === 'DENIED' ? 'DENIED' : 'APPROVED'
    : (decision?.status ?? 'PROCESSING');

  return {
    requestId: request.publicId,
    orderNumber: row.orderNumber,
    status,
    customerMessage: resolution?.customerMessage ?? decision?.customerMessage ?? null,
    approvedAmountMinor: resolution?.approvedAmountMinor ?? decision?.approvedAmountMinor ?? 0,
    lines: lines.map((l) => ({ itemName: l.name, quantity: l.quantity, outcome: l.status ?? 'PROCESSING' })),
    createdAt: request.createdAt.toISOString(),
  };
}

/** "My requests": the customer's own requests, newest first (bounded). */
export async function listCustomerRequests(db: Database, customerId: string, limit = 50): Promise<CustomerRequestViewDto[]> {
  const rows = await db
    .select({ id: refundRequests.id })
    .from(refundRequests)
    .where(eq(refundRequests.customerId, customerId))
    .orderBy(desc(refundRequests.createdAt))
    .limit(limit);
  const views = await Promise.all(rows.map((r) => loadCustomerRequestView(db, customerId, { requestId: r.id })));
  return views.filter((v): v is CustomerRequestViewDto => v !== null);
}
