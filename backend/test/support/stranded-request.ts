import type { Database } from '../../src/database/database.types.js';
import * as schema from '../../src/database/schema/index.js';
import type { RefundReason } from '../../src/policy/refund-reasons.js';
import { generatePublicRequestId } from '../../src/refunds/generate-public-request-id.js';
import { demoOrder } from './demo-lookup.js';

/**
 * A request left PROCESSING by a worker that died: what a crash between transaction 1
 * and transaction 2 leaves behind.
 */
export async function strandedRequest(
  db: Database,
  options: { orderNumber: string; sku: string; reason: RefundReason; leaseExpiresAt: Date; attemptCount?: number },
) {
  const order = await demoOrder(db, options.orderNumber, [options.sku]);
  const [version] = await db.select().from(schema.policyVersions).limit(1);
  const [request] = await db
    .insert(schema.refundRequests)
    .values({
      publicId: generatePublicRequestId(),
      customerId: order.customerId,
      orderId: order.orderId,
      policyVersionId: version.id,
      idempotencyKey: crypto.randomUUID(),
      payloadHash: 'd'.repeat(64),
      reasonConfirmed: options.reason,
      leaseOwner: 'dead-worker',
      leaseExpiresAt: options.leaseExpiresAt,
      attemptCount: options.attemptCount ?? 1,
    })
    .returning();
  const item = order.items.find((i) => i.sku === options.sku)!;
  await db.insert(schema.refundRequestLines).values({
    requestId: request.id, orderId: order.orderId, orderItemId: item.id, quantity: 1, amountMinor: item.unitPricePaidMinor,
  });
  return request;
}
