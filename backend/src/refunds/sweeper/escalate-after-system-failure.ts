import { and, eq } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';
import { auditEvents, decisions, refundRequestLines, refundRequests } from '../../database/schema/index.js';
import { SYSTEM_FAILURE_CUSTOMER_MESSAGE } from '../messages/system-failure-customer-message.js';

/**
 * Last resort after repeated processing failures: hand the request to a person instead of
 * leaving it stuck. Written only while `leaseOwner` holds the lease (same rule as a normal decision).
 * The rules never ran, so there is no rule trace; every line stays reserved for the reviewer.
 */
export async function escalateAfterSystemFailure(db: Database, requestId: string, leaseOwner: string, attempts: number): Promise<boolean> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(refundRequests)
      .set({ state: 'DECIDED', leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
      .where(and(eq(refundRequests.id, requestId), eq(refundRequests.state, 'PROCESSING'), eq(refundRequests.leaseOwner, leaseOwner)))
      .returning({ policyVersionId: refundRequests.policyVersionId });
    if (claimed.length === 0) return false;

    await tx.insert(decisions).values({
      requestId,
      status: 'ESCALATED',
      approvedAmountMinor: 0,
      policyVersionId: claimed[0].policyVersionId,
      ruleTrace: null,
      escalationReasons: ['SYSTEM_PROCESSING_FAILURE'],
      customerMessage: SYSTEM_FAILURE_CUSTOMER_MESSAGE,
      messageSource: 'TEMPLATE',
      createdAt: now,
    });
    await tx.update(refundRequestLines).set({ finalLineStatus: 'UNDER_REVIEW' }).where(eq(refundRequestLines.requestId, requestId));
    await tx.insert(auditEvents).values([
      { requestId, type: 'SYSTEM_PROCESSING_FAILED', actor: 'SYSTEM', data: { attempts }, createdAt: now },
      { requestId, type: 'DECISION_RECORDED', actor: 'SYSTEM', data: { status: 'ESCALATED', reason: 'SYSTEM_PROCESSING_FAILURE' }, createdAt: now },
    ]);
    return true;
  });
}
