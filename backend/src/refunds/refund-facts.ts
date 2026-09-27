import { and, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../database/database.js';
import { orderItems, orders, refundRequestLines, refundRequests } from '../database/schema.js';
import { wholeDaysBetween, type LineInput, type RequestHistoryFacts } from '../policy/policy-engine.js';
import type { RefundReason } from '../policy/policy-schema.js';

export interface RequestedLine {
  orderItemId: string;
  quantity: number;
}

export interface RequestFactInput {
  customerId: string;
  orderId: string;
  reason: RefundReason;
  lines: readonly RequestedLine[];
  /** The moment the request is judged at (its submission time). */
  at: Date;
  /** The request being judged, excluded from its own history. */
  excludeRequestId?: string;
}

/** A requested item doesn't belong to the order (or the order isn't the customer's). */
export class ItemNotInOrderError extends Error {
  constructor(readonly orderItemIds: string[]) {
    super(`Items not found in this order: ${orderItemIds.join(', ')}`);
    this.name = 'ItemNotInOrderError';
  }
}

const FREQUENCY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface RequestFacts {
  lines: LineInput[];
  history: RequestHistoryFacts;
}

/**
 * Reads everything the policy needs from the database, as of `input.at`. Amounts come
 * from what the customer paid, never from the client. Line ids are the order item ids.
 * Pass a transaction as `db` to read consistently with locks taken by the caller.
 */
export async function buildRequestFacts(db: Database, input: RequestFactInput): Promise<RequestFacts> {
  const itemIds = input.lines.map((l) => l.orderItemId);
  const notThisRequest = input.excludeRequestId ? ne(refundRequests.id, input.excludeRequestId) : undefined;

  const items = await db
    .select({
      id: orderItems.id,
      unitPricePaidMinor: orderItems.unitPricePaidMinor,
      finalSale: orderItems.finalSale,
      category: orderItems.category,
      deliveredAt: orders.deliveredAt,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(inArray(orderItems.id, itemIds), eq(orders.id, input.orderId), eq(orders.customerId, input.customerId)));
  const byId = new Map(items.map((i) => [i.id, i]));
  const missing = itemIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new ItemNotInOrderError(missing);

  // Items with an earlier line that ended NOT_REFUNDED (automatic denial or a reviewer's "no").
  const deniedRows = await db
    .selectDistinct({ orderItemId: refundRequestLines.orderItemId })
    .from(refundRequestLines)
    .innerJoin(refundRequests, eq(refundRequests.id, refundRequestLines.requestId))
    .where(and(inArray(refundRequestLines.orderItemId, itemIds), eq(refundRequestLines.finalLineStatus, 'NOT_REFUNDED'), lte(refundRequests.createdAt, input.at), notThisRequest));
  const previouslyDenied = new Set(deniedRows.map((r) => r.orderItemId));

  // Money already refunded, awaiting a reviewer, or still being processed on this order.
  const [{ refundedOrPending }] = await db
    .select({ refundedOrPending: sql<number>`coalesce(sum(${refundRequestLines.amountMinor}), 0)::int` })
    .from(refundRequestLines)
    .innerJoin(refundRequests, eq(refundRequests.id, refundRequestLines.requestId))
    .where(
      and(
        eq(refundRequestLines.orderId, input.orderId),
        lte(refundRequests.createdAt, input.at),
        notThisRequest,
        or(
          inArray(refundRequestLines.finalLineStatus, ['REFUNDED', 'UNDER_REVIEW']),
          and(isNull(refundRequestLines.finalLineStatus), eq(refundRequests.state, 'PROCESSING')),
        ),
      ),
    );

  const [{ recentRequests }] = await db
    .select({ recentRequests: sql<number>`count(*)::int` })
    .from(refundRequests)
    .where(
      and(
        eq(refundRequests.customerId, input.customerId),
        gt(refundRequests.createdAt, new Date(input.at.getTime() - FREQUENCY_WINDOW_MS)),
        lte(refundRequests.createdAt, input.at),
        notThisRequest,
      ),
    );

  const lines: LineInput[] = input.lines.map((line) => {
    const item = byId.get(line.orderItemId)!;
    const amountMinor = item.unitPricePaidMinor * line.quantity;
    if (!Number.isSafeInteger(amountMinor)) throw new RangeError(`Amount overflow for item ${line.orderItemId}`);
    return {
      lineId: line.orderItemId,
      amountMinor,
      facts: {
        'item.delivered': item.deliveredAt !== null,
        'item.daysSinceDelivery': item.deliveredAt ? wholeDaysBetween(item.deliveredAt, input.at) : null,
        'item.finalSale': item.finalSale,
        'item.category': item.category,
        'item.priorDeniedRequest': previouslyDenied.has(line.orderItemId),
        'claim.reason': input.reason,
      },
    };
  });

  return {
    lines,
    history: {
      'order.refundedOrPendingMinor': refundedOrPending,
      'customer.requestsLast30Days': recentRequests,
    },
  };
}
