import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, ne, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../common/canonical-json.js';
import { domainErrors } from '../common/domain-exception.js';
import { generatePublicRequestId } from '../common/validation.js';
import type { ProposalRecord } from '../conversations/chat-turn.js';
import { DATABASE, isUniqueViolation, type Database } from '../database/database.providers.js';
import { auditEvents, conversations, decisions, orderItems, orders, refundRequestLines, refundRequests, reviewResolutions } from '../database/schema.js';
import { OrdersService } from '../orders/orders.service.js';
import { NoActivePolicyError, PolicyService } from '../policy/policy.service.js';
import type { ClaimContext } from './decision.rules.js';
import { DecisionService, newLease } from './decision.service.js';
import type { CustomerRequestViewDto, SubmitRefundRequestDto } from './dto/refunds.dto.js';
import { ReviewSummaryService } from './review-summary.service.js';

export type RefundErrorCode =
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'ORDER_OR_ITEM_NOT_FOUND'
  | 'ALREADY_IN_PROGRESS'
  | 'NOTHING_LEFT_TO_REFUND'
  | 'QUANTITY_TOO_HIGH'
  | 'NO_ACTIVE_POLICY'
  | 'CONVERSATION_ALREADY_SUBMITTED';

export const refundError = domainErrors<RefundErrorCode>({
  IDEMPOTENCY_KEY_REQUIRED: HttpStatus.BAD_REQUEST,
  IDEMPOTENCY_KEY_REUSED: HttpStatus.CONFLICT,
  ORDER_OR_ITEM_NOT_FOUND: HttpStatus.NOT_FOUND,
  ALREADY_IN_PROGRESS: HttpStatus.CONFLICT,
  NOTHING_LEFT_TO_REFUND: HttpStatus.UNPROCESSABLE_ENTITY,
  QUANTITY_TOO_HIGH: HttpStatus.UNPROCESSABLE_ENTITY,
  NO_ACTIVE_POLICY: HttpStatus.SERVICE_UNAVAILABLE,
  CONVERSATION_ALREADY_SUBMITTED: HttpStatus.CONFLICT,
});

/** created: a new request (201); replayed: same key and claim seen before (200). */
export interface SubmissionOutcome {
  kind: 'created' | 'replayed';
  view: CustomerRequestViewDto;
}

export interface ReservedRequest {
  requestId: string;
  leaseOwner: string;
}

type RequestLookup = { requestId: string } | { publicId: string };

/** Identifies the claim itself: line order doesn't matter, any real change does. */
export function computePayloadHash(dto: SubmitRefundRequestDto): string {
  const claim = {
    orderNumber: dto.orderNumber,
    reason: dto.reason,
    lines: dto.lines.map((l) => ({ itemId: l.itemId.toLowerCase(), quantity: l.quantity })).sort((a, b) => a.itemId.localeCompare(b.itemId)),
    // Included only when present, so hashes of claims without a conversation are unchanged.
    ...(dto.conversationId ? { conversationId: dto.conversationId.toLowerCase() } : {}),
  };
  return createHash('sha256').update(canonicalJson(claim)).digest('hex');
}

/**
 * Thrown inside transaction 1 when, after waiting for the item locks, a request with the same
 * idempotency key already exists (a simultaneous retry won). Answered as a replay, not a conflict.
 */
class IdempotentReplaySignal extends Error {}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;
const FLAG_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 50;
const itemNotFound = () => refundError('ORDER_OR_ITEM_NOT_FOUND', "We couldn't find that item in your orders.");

/** Customer refund requests: exactly-once submission and the customer's view of the outcome. */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly orders: OrdersService,
    private readonly policies: PolicyService,
    private readonly decisions: DecisionService,
    private readonly summaries: ReviewSummaryService,
  ) {}

  /**
   * Submits a confirmed claim exactly once per idempotency key:
   *  - new key: reserve (transaction 1), decide, store (transaction 2);
   *  - same key, same claim: return what is stored, finishing it if its worker died;
   *  - same key, different claim: 409.
   */
  async submit(customerId: string, idempotencyKey: string | undefined, dto: SubmitRefundRequestDto): Promise<SubmissionOutcome> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw refundError('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header (8–100 letters, digits, - or _) is required.');
    }
    const payloadHash = computePayloadHash(dto);

    const replay = await this.replay(customerId, idempotencyKey, payloadHash);
    if (replay) return replay;

    let reserved: ReservedRequest;
    try {
      reserved = await this.reserve(customerId, idempotencyKey, payloadHash, dto);
    } catch (error) {
      // A simultaneous retry with the same key won: answer with its result.
      if (error instanceof IdempotentReplaySignal || isUniqueViolation(error)) {
        const concurrent = await this.replay(customerId, idempotencyKey, payloadHash);
        if (concurrent) return concurrent;
      }
      throw error;
    }

    await this.decideSafely(reserved.requestId, reserved.leaseOwner);
    // Runs after the response so reviewer notes never delay the customer.
    void this.summaries.summarize(reserved.requestId);
    return { kind: 'created', view: (await this.view(customerId, { requestId: reserved.requestId }))! };
  }

  /** "My requests": the customer's own requests, newest first (bounded). */
  async list(customerId: string): Promise<CustomerRequestViewDto[]> {
    const rows = await this.db
      .select({ id: refundRequests.id })
      .from(refundRequests)
      .where(eq(refundRequests.customerId, customerId))
      .orderBy(desc(refundRequests.createdAt))
      .limit(HISTORY_LIMIT);
    const views = await Promise.all(rows.map((r) => this.view(customerId, { requestId: r.id })));
    return views.filter((v): v is CustomerRequestViewDto => v !== null);
  }

  /**
   * The customer's view of one of their own requests, or null (also for someone else's).
   * A reviewer's resolution, when present, is the effective outcome.
   */
  async view(customerId: string, where: RequestLookup): Promise<CustomerRequestViewDto | null> {
    const [row] = await this.db
      .select({ request: refundRequests, orderNumber: orders.orderNumber, decision: decisions, resolution: reviewResolutions })
      .from(refundRequests)
      .innerJoin(orders, eq(orders.id, refundRequests.orderId))
      .leftJoin(decisions, eq(decisions.requestId, refundRequests.id))
      .leftJoin(reviewResolutions, eq(reviewResolutions.requestId, refundRequests.id))
      .where(
        and(
          eq(refundRequests.customerId, customerId),
          'requestId' in where ? eq(refundRequests.id, where.requestId) : eq(refundRequests.publicId, where.publicId),
        ),
      );
    if (!row) return null;
    const { request, decision, resolution } = row;

    const lines = await this.db
      .select({ quantity: refundRequestLines.quantity, status: refundRequestLines.finalLineStatus, name: orderItems.name })
      .from(refundRequestLines)
      .innerJoin(orderItems, eq(orderItems.id, refundRequestLines.orderItemId))
      .where(eq(refundRequestLines.requestId, request.id))
      .orderBy(orderItems.name);

    const status = resolution ? (resolution.outcome === 'DENIED' ? 'DENIED' : 'APPROVED') : (decision?.status ?? 'PROCESSING');
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

  /** An earlier submission with this key, finished first if its worker died; null for a new key. */
  protected async replay(customerId: string, idempotencyKey: string, payloadHash: string): Promise<SubmissionOutcome | null> {
    const [existing] = await this.db
      .select()
      .from(refundRequests)
      .where(and(eq(refundRequests.customerId, customerId), eq(refundRequests.idempotencyKey, idempotencyKey)));
    if (!existing) return null;
    if (existing.payloadHash !== payloadHash) {
      throw refundError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.');
    }
    if (existing.state === 'PROCESSING' && existing.leaseExpiresAt && existing.leaseExpiresAt < new Date()) {
      const leaseOwner = await this.decisions.reclaimExpiredLease(existing.id);
      if (leaseOwner) await this.decideSafely(existing.id, leaseOwner);
    }
    return { kind: 'replayed', view: (await this.view(customerId, { requestId: existing.id }))! };
  }

  /**
   * Transaction 1: validates the claim and reserves the quantities. Item rows are locked
   * (SELECT … FOR UPDATE), so simultaneous submissions for one item run one after the other
   * and the second sees the first one's reservation. Nothing slow (no AI) runs here.
   */
  protected async reserve(customerId: string, idempotencyKey: string, payloadHash: string, dto: SubmitRefundRequestDto, now = new Date()): Promise<ReservedRequest> {
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.orderNumber, dto.orderNumber), eq(orders.customerId, customerId)));
      if (!order) throw itemNotFound();

      const itemIds = dto.lines.map((l) => l.itemId.toLowerCase());
      const items = await tx
        .select({ id: orderItems.id, unitPricePaidMinor: orderItems.unitPricePaidMinor })
        .from(orderItems)
        .where(and(inArray(orderItems.id, itemIds), eq(orderItems.orderId, order.id)))
        .orderBy(orderItems.id) // consistent lock order: no deadlocks between concurrent submissions
        .for('update');
      if (items.length !== itemIds.length) throw itemNotFound();

      // Checked before quantities: a simultaneous retry with the same key is the same claim.
      const [sameKey] = await tx
        .select({ id: refundRequests.id })
        .from(refundRequests)
        .where(and(eq(refundRequests.customerId, customerId), eq(refundRequests.idempotencyKey, idempotencyKey)));
      if (sameKey) throw new IdempotentReplaySignal();

      const claim = await this.captureClaimContext(tx, customerId, dto.conversationId?.toLowerCase() ?? null, now);

      const quantities = await this.orders.itemQuantities(itemIds, tx);
      for (const line of dto.lines) {
        const q = quantities.get(line.itemId.toLowerCase())!;
        if (line.quantity <= q.refundable) continue;
        if (q.refundable === 0 && q.pending > 0) throw refundError('ALREADY_IN_PROGRESS', 'A request for this item is already being processed or reviewed.');
        if (q.refundable === 0) throw refundError('NOTHING_LEFT_TO_REFUND', 'This item has already been refunded.');
        throw refundError('QUANTITY_TOO_HIGH', `Only ${q.refundable} of this item can be refunded.`);
      }

      let policyVersionId: string;
      try {
        policyVersionId = (await this.policies.activePolicy(now, tx)).id;
      } catch (error) {
        if (error instanceof NoActivePolicyError) throw refundError('NO_ACTIVE_POLICY', 'Refunds are temporarily unavailable. Please try again later.');
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

  /**
   * Snapshots what the safety gate needs. The conversation row is locked and marked SUBMITTED,
   * which serialises two submissions from the same chat.
   */
  private async captureClaimContext(tx: Database, customerId: string, conversationId: string | null, now: Date): Promise<{ context: ClaimContext; proposal: ProposalRecord | null }> {
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
      return { context: { conversationId: null, handoverReason: null, discussedItemIds: [], flags: null, priorFlaggedConversation }, proposal: null };
    }

    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.customerId, customerId)))
      .for('update');
    if (!conversation) throw refundError('ORDER_OR_ITEM_NOT_FOUND', "We couldn't find that conversation.");
    if (conversation.state !== 'ACTIVE') throw refundError('CONVERSATION_ALREADY_SUBMITTED', 'A claim was already submitted from this conversation.');
    await tx.update(conversations).set({ state: 'SUBMITTED', updatedAt: now }).where(eq(conversations.id, conversationId));

    return {
      context: {
        conversationId,
        handoverReason: conversation.handoverReason as ClaimContext['handoverReason'],
        discussedItemIds: conversation.discussedItemIds,
        flags: conversation.flags,
        priorFlaggedConversation,
      },
      proposal: (conversation.latestProposal as ProposalRecord | null) ?? null,
    };
  }

  /**
   * A failure leaves the request PROCESSING with its reservation: the customer sees "processing",
   * and a retry or the sweeper finishes it once the lease expires.
   */
  private async decideSafely(requestId: string, leaseOwner: string): Promise<void> {
    try {
      await this.decisions.decide(requestId, leaseOwner);
    } catch (error) {
      this.logger.error(`Deciding request ${requestId} failed; it stays PROCESSING for retry`, (error as Error).stack);
    }
  }
}
