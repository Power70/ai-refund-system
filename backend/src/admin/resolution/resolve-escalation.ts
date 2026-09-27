import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';
import { pgErrorCode } from '../../database/pg-error-code.js';
import { auditEvents, decisions, orderItems, orders, refundRequestLines, refundRequests, reviewResolutions } from '../../database/schema/index.js';
import { resolutionCustomerMessage } from '../../refunds/messages/resolution-customer-message.js';
import { deriveResolution } from './derive-resolution.js';
import type { ResolveEscalationDto } from './dto/resolve-escalation.dto.js';
import { ResolutionException } from './resolution.exception.js';

const UNIQUE_VIOLATION = '23505';

/**
 * Records a person's line-by-line decision on an escalated request, in one transaction:
 * the resolution, the new line statuses (approved → REFUNDED, rejected → NOT_REFUNDED, which
 * frees the quantity) and an audit event. The automated decision is left untouched.
 * The request row is locked first, so two reviewers can't both resolve the same case.
 */
export async function resolveEscalation(db: Database, publicId: string, input: ResolveEscalationDto, now = new Date()): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [request] = await tx
        .select({ id: refundRequests.id, currency: orders.currency })
        .from(refundRequests)
        .innerJoin(orders, eq(orders.id, refundRequests.orderId))
        .where(eq(refundRequests.publicId, publicId))
        .for('update', { of: refundRequests });
      if (!request) throw new ResolutionException('REQUEST_NOT_FOUND', 'Request not found.');

      const [decision] = await tx.select({ status: decisions.status }).from(decisions).where(eq(decisions.requestId, request.id));
      if (decision?.status !== 'ESCALATED') throw new ResolutionException('NOT_ESCALATED', 'Only escalated requests can be resolved.');

      const [existing] = await tx.select({ id: reviewResolutions.id }).from(reviewResolutions).where(eq(reviewResolutions.requestId, request.id));
      if (existing) throw new ResolutionException('ALREADY_RESOLVED', 'This request has already been resolved.');

      const lines = await tx
        .select({ id: refundRequestLines.id, amountMinor: refundRequestLines.amountMinor, lineOutcome: refundRequestLines.lineOutcome, itemName: orderItems.name })
        .from(refundRequestLines)
        .innerJoin(orderItems, eq(orderItems.id, refundRequestLines.orderItemId))
        .where(eq(refundRequestLines.requestId, request.id))
        .orderBy(asc(orderItems.name), asc(refundRequestLines.id));

      const resolution = deriveResolution(lines, input.lineDecisions);
      if (!resolution) throw new ResolutionException('LINES_MISMATCH', 'Decide every line of this request exactly once.');

      const approveById = new Map(resolution.lineDecisions.map((d) => [d.lineId, d.approve]));
      const customerMessage = resolutionCustomerMessage(
        resolution.outcome,
        lines.map((l) => ({ itemName: l.itemName, approve: approveById.get(l.id)! })),
        resolution.approvedAmountMinor,
        request.currency,
      );

      await tx.insert(reviewResolutions).values({
        requestId: request.id,
        outcome: resolution.outcome,
        lineDecisions: resolution.lineDecisions,
        approvedAmountMinor: resolution.approvedAmountMinor,
        reviewerNote: input.reviewerNote,
        customerMessage,
        createdAt: now,
      });

      for (const approve of [true, false]) {
        const ids = resolution.lineDecisions.filter((d) => d.approve === approve).map((d) => d.lineId);
        if (ids.length === 0) continue;
        const updated = await tx
          .update(refundRequestLines)
          .set({ finalLineStatus: approve ? 'REFUNDED' : 'NOT_REFUNDED' })
          .where(and(inArray(refundRequestLines.id, ids), eq(refundRequestLines.finalLineStatus, 'UNDER_REVIEW')))
          .returning({ id: refundRequestLines.id });
        // Every line of an escalated request is held UNDER_REVIEW; anything else is a broken invariant.
        if (updated.length !== ids.length) throw new Error(`Request ${publicId}: expected ${ids.length} lines under review, found ${updated.length}`);
      }

      await tx.update(refundRequests).set({ updatedAt: now }).where(eq(refundRequests.id, request.id));
      await tx.insert(auditEvents).values({
        requestId: request.id,
        type: 'REVIEW_RESOLVED',
        actor: 'ADMIN',
        data: {
          outcome: resolution.outcome,
          approvedAmountMinor: resolution.approvedAmountMinor,
          // Recorded so the trail shows when a person refunded a line the policy would have denied.
          lines: lines.map((l) => ({ lineId: l.id, approve: approveById.get(l.id)!, policyOutcome: l.lineOutcome })),
        },
        createdAt: now,
      });
    });
  } catch (error) {
    // Backstop for the unique constraint on review_resolutions.request_id.
    if (pgErrorCode(error) === UNIQUE_VIOLATION) throw new ResolutionException('ALREADY_RESOLVED', 'This request has already been resolved.');
    throw error;
  }
}
