import { asc, eq, or } from 'drizzle-orm';
import type { Database } from '../database/database.types.js';
import {
  aiCalls,
  auditEvents,
  conversationMessages,
  conversations,
  customers,
  decisions,
  orderItems,
  orders,
  policyVersions,
  refundRequestLines,
  refundRequests,
  reviewResolutions,
} from '../database/schema/index.js';
import type { CaseSummary } from '../conversations/case-summary.js';
import type { ProposalRecord } from '../conversations/verify-turn.js';
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

  const [lines, [decisionRow], [resolution], audit, [conversation], transcript, calls] = await Promise.all([
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
    request.conversationId ? db.select().from(conversations).where(eq(conversations.id, request.conversationId)) : Promise.resolve([]),
    request.conversationId
      ? db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, request.conversationId))
          .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.role))
      : Promise.resolve([]),
    db
      .select()
      .from(aiCalls)
      .where(request.conversationId ? or(eq(aiCalls.requestId, request.id), eq(aiCalls.conversationId, request.conversationId)) : eq(aiCalls.requestId, request.id))
      .orderBy(asc(aiCalls.createdAt)),
  ]);
  const proposal = request.aiProposal as ProposalRecord | null;
  const summaryCall = calls.find((c) => c.kind === 'ADMIN_SUMMARY');
  const discussed = new Set(request.claimContext?.discussedItemIds ?? []);

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
    conversation: conversation
      ? {
          conversationId: conversation.id,
          mode: conversation.mode,
          handoverReason: conversation.handoverReason,
          flags: conversation.flags,
          priorFlaggedConversation: request.claimContext?.priorFlaggedConversation ?? false,
          transcript: transcript.map((m) => ({ role: m.role, text: m.content, typed: m.typed, at: m.createdAt.toISOString() })),
          evidenceQuotes: proposal?.evidenceQuotes ?? [],
        }
      : null,
    claim: {
      proposed: proposal
        ? { reason: proposal.reason, confidence: proposal.confidence, lines: proposal.lines.map((l) => ({ itemName: l.itemName, quantity: l.quantity })) }
        : null,
      confirmed: { reason: request.reasonConfirmed, lines: lines.map(({ line, item }) => ({ itemName: item.name, quantity: line.quantity })) },
      reasonOverridden: request.reasonOverridden,
      itemsNotDiscussed: conversation ? lines.filter(({ line }) => !discussed.has(line.orderItemId)).map(({ item }) => item.name) : [],
    },
    aiSummary: summaryCall?.outcome === 'OK' ? (summaryCall.validatedOutput as CaseSummary) : null,
    aiSummarySuppressed: summaryCall?.failureReason === 'INJECTION_FLAGGED',
    aiCalls: calls.map((c) => ({
      kind: c.kind,
      provider: c.provider,
      model: c.model,
      outcome: c.outcome,
      attempts: c.attempts,
      latencyMs: c.latencyMs,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      at: c.createdAt.toISOString(),
    })),
    audit: audit.map((a) => ({ type: a.type, actor: a.actor, data: a.data, at: a.createdAt.toISOString() })),
  };
}
