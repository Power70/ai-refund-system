import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';
import { auditEvents, orderItems, orders, refundRequestLines, refundRequests } from '../../database/schema/index.js';
import { loadItemQuantities } from '../../orders/load-item-quantities.js';
import { findActivePolicy } from '../../policy/registry/find-active-policy.js';
import { NoActivePolicyError } from '../../policy/registry/no-active-policy.error.js';
import { generatePublicRequestId } from '../generate-public-request-id.js';
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
      data: { reason: dto.reason, lines: dto.lines.map((l) => ({ itemId: l.itemId.toLowerCase(), quantity: l.quantity })) },
      createdAt: now,
    });

    return { requestId: request.id, leaseOwner: lease.leaseOwner };
  });
}

function notFound(): RefundRequestException {
  return new RefundRequestException('ORDER_OR_ITEM_NOT_FOUND', "We couldn't find that item in your orders.");
}
