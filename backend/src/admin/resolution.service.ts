import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { domainErrors } from '../common/domain-exception.js';
import { DATABASE, isUniqueViolation, type Database } from '../database/database.providers.js';
import { auditEvents, decisions, orderItems, orders, refundRequestLines, refundRequests, reviewResolutions, type LineResolution, type ResolutionOutcome } from '../database/schema.js';
import { resolutionCustomerMessage } from '../refunds/customer-messages.service.js';
import type { ResolveEscalationDto } from './dto/admin.dto.js';

export type ResolutionErrorCode = 'REQUEST_NOT_FOUND' | 'NOT_ESCALATED' | 'ALREADY_RESOLVED' | 'LINES_MISMATCH';

export const resolutionError = domainErrors<ResolutionErrorCode>({
  REQUEST_NOT_FOUND: HttpStatus.NOT_FOUND,
  NOT_ESCALATED: HttpStatus.CONFLICT,
  ALREADY_RESOLVED: HttpStatus.CONFLICT,
  LINES_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
});

const alreadyResolved = () => resolutionError('ALREADY_RESOLVED', 'This request has already been resolved.');

export interface ResolvableLine {
  id: string;
  amountMinor: number;
}

export interface DerivedResolution {
  outcome: ResolutionOutcome;
  approvedAmountMinor: number;
  /** One decision per line, in the request's line order. */
  lineDecisions: LineResolution[];
}

/**
 * Turns a reviewer's yes/no per line into the stored resolution. The reviewer never types
 * an amount: the outcome and total come from the approved lines, so money and quantities agree.
 * Returns null unless the decisions cover exactly the request's lines, each once.
 */
export function deriveResolution(lines: readonly ResolvableLine[], decisions: readonly LineResolution[]): DerivedResolution | null {
  const approveById = new Map(decisions.map((d) => [d.lineId, d.approve]));
  if (lines.length === 0 || approveById.size !== decisions.length || approveById.size !== lines.length) return null;
  if (lines.some((line) => !approveById.has(line.id))) return null;

  const lineDecisions = lines.map((line) => ({ lineId: line.id, approve: approveById.get(line.id)! }));
  const approved = lines.filter((line) => approveById.get(line.id));
  const outcome: ResolutionOutcome = approved.length === 0 ? 'DENIED' : approved.length === lines.length ? 'APPROVED' : 'PARTIALLY_APPROVED';
  return { outcome, approvedAmountMinor: approved.reduce((sum, line) => sum + line.amountMinor, 0), lineDecisions };
}

/** A reviewer's final decision on an escalated request. */
@Injectable()
export class ResolutionService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Records a person's line-by-line decision in one transaction: the resolution, the new line
   * statuses (approved → REFUNDED, rejected → NOT_REFUNDED, which frees the quantity) and an
   * audit event. The automated decision is left untouched. The request row is locked first,
   * so two reviewers can't both resolve the same case.
   */
  async resolve(publicId: string, input: ResolveEscalationDto, now = new Date()): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const [request] = await tx
          .select({ id: refundRequests.id, currency: orders.currency })
          .from(refundRequests)
          .innerJoin(orders, eq(orders.id, refundRequests.orderId))
          .where(eq(refundRequests.publicId, publicId))
          .for('update', { of: refundRequests });
        if (!request) throw resolutionError('REQUEST_NOT_FOUND', 'Request not found.');

        const [decision] = await tx.select({ status: decisions.status }).from(decisions).where(eq(decisions.requestId, request.id));
        if (decision?.status !== 'ESCALATED') throw resolutionError('NOT_ESCALATED', 'Only escalated requests can be resolved.');

        const [existing] = await tx.select({ id: reviewResolutions.id }).from(reviewResolutions).where(eq(reviewResolutions.requestId, request.id));
        if (existing) throw alreadyResolved();

        const lines = await tx
          .select({ id: refundRequestLines.id, amountMinor: refundRequestLines.amountMinor, lineOutcome: refundRequestLines.lineOutcome, itemName: orderItems.name })
          .from(refundRequestLines)
          .innerJoin(orderItems, eq(orderItems.id, refundRequestLines.orderItemId))
          .where(eq(refundRequestLines.requestId, request.id))
          .orderBy(asc(orderItems.name), asc(refundRequestLines.id));

        const resolution = deriveResolution(lines, input.lineDecisions);
        if (!resolution) throw resolutionError('LINES_MISMATCH', 'Decide every line of this request exactly once.');

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
      if (isUniqueViolation(error)) throw alreadyResolved();
      throw error;
    }
  }
}
