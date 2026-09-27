import { and, eq } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';
import { decisions, orderItems, orders, refundRequestLines, refundRequests, reviewResolutions } from '../../database/schema/index.js';
import type { CustomerRequestViewDto } from './dto/customer-request-view.dto.js';

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
