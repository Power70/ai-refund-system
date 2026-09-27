import { asc, eq } from 'drizzle-orm';
import type { Database } from '../database/database.types.js';
import { auditEvents, customers, decisions, orderItems, orders, policyVersions, refundRequestLines, refundRequests, reviewResolutions } from '../database/schema/index.js';
import type { CaseBriefDto } from './dto/case-brief.dto.js';

/** The full case for one request (by public id), or null. */
export async function loadCaseBrief(db: Database, publicId: string): Promise<CaseBriefDto | null> {
  const [row] = await db
    .select({ request: refundRequests, customer: customers, order: orders })
    .from(refundRequests)
    .innerJoin(customers, eq(customers.id, refundRequests.customerId))
    .innerJoin(orders, eq(orders.id, refundRequests.orderId))
    .where(eq(refundRequests.publicId, publicId));
  if (!row) return null;
  const { request, customer, order } = row;

  const [lines, [decisionRow], [resolution], audit] = await Promise.all([
    db
      .select({ line: refundRequestLines, item: orderItems })
      .from(refundRequestLines)
      .innerJoin(orderItems, eq(orderItems.id, refundRequestLines.orderItemId))
      .where(eq(refundRequestLines.requestId, request.id))
      .orderBy(asc(orderItems.name)),
    db
      .select({ decision: decisions, version: policyVersions.version })
      .from(decisions)
      .innerJoin(policyVersions, eq(policyVersions.id, decisions.policyVersionId))
      .where(eq(decisions.requestId, request.id)),
    db.select().from(reviewResolutions).where(eq(reviewResolutions.requestId, request.id)),
    db.select().from(auditEvents).where(eq(auditEvents.requestId, request.id)).orderBy(asc(auditEvents.createdAt)),
  ]);

  const decision = decisionRow?.decision;
  const publicReasonByItem = new Map((decision?.ruleTrace?.lines ?? []).map((l) => [l.lineId, l.publicReason]));
  const itemNameByLine = new Map(lines.map(({ line, item }) => [line.id, item.name]));

  return {
    request: {
      requestId: request.publicId,
      source: request.source,
      state: request.state,
      createdAt: request.createdAt.toISOString(),
      attempts: request.attemptCount,
      reasonConfirmed: request.reasonConfirmed,
      reasonOverridden: request.reasonOverridden,
      aiProposal: request.aiProposal,
    },
    customer: { name: customer.name, email: customer.email },
    order: {
      orderNumber: order.orderNumber,
      placedAt: order.placedAt.toISOString(),
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      currency: order.currency,
    },
    lines: lines.map(({ line, item }) => ({
      lineId: line.id,
      itemName: item.name,
      sku: item.sku,
      finalSale: item.finalSale,
      quantity: line.quantity,
      amountMinor: line.amountMinor,
      lineOutcome: line.lineOutcome,
      decidingRuleId: line.decidingRuleId,
      publicReason: publicReasonByItem.get(item.id) ?? null,
      finalLineStatus: line.finalLineStatus,
    })),
    decision: decision
      ? {
          status: decision.status,
          approvedAmountMinor: decision.approvedAmountMinor,
          escalationReasons: decision.escalationReasons,
          customerMessage: decision.customerMessage,
          messageSource: decision.messageSource,
          policyVersion: decisionRow.version,
          gateResult: decision.gateResult,
          ruleTrace: decision.ruleTrace,
          decidedAt: decision.createdAt.toISOString(),
        }
      : null,
    resolution: resolution
      ? {
          outcome: resolution.outcome,
          approvedAmountMinor: resolution.approvedAmountMinor,
          reviewerNote: resolution.reviewerNote,
          customerMessage: resolution.customerMessage,
          lines: resolution.lineDecisions.map((d) => ({ lineId: d.lineId, itemName: itemNameByLine.get(d.lineId) ?? 'unknown item', approve: d.approve })),
          resolvedAt: resolution.createdAt.toISOString(),
        }
      : null,
    audit: audit.map((a) => ({ type: a.type, actor: a.actor, data: a.data, at: a.createdAt.toISOString() })),
  };
}
