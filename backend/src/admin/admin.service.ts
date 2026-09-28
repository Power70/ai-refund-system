import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { LlmService } from '../ai/llm.service.js';
import type { ProposalRecord } from '../conversations/chat-turn.js';
import { DATABASE, type Database } from '../database/database.providers.js';
import { aiCalls, auditEvents, conversationMessages, conversations, customers, decisions, orderItems, orders, policyVersions, refundRequestLines, refundRequests, reviewResolutions } from '../database/schema.js';
import { HealthService } from '../health/health.service.js';
import type { CaseSummary } from '../refunds/review-summary.service.js';
import type { AdminMetricsDto, AdminQueueDto, AdminQueueQueryDto, CaseBriefDto, EscalationReasonCountDto } from './dto/admin.dto.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_REASONS = 10;

/** Escapes LIKE wildcards so user search text matches literally (default escape char: backslash). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Read models for the support dashboard: the queue, one case in full, and counters. */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly health: HealthService,
    private readonly llm: LlmService,
  ) {}

  /**
   * The support queue. "needs-review" = escalations nobody has resolved yet, oldest first
   * (so none are forgotten); "all" = everything, newest first. One query per page plus a count.
   */
  async queue(query: AdminQueueQueryDto): Promise<AdminQueueDto> {
    const lineSummary = this.db
      .select({
        requestId: refundRequestLines.requestId,
        requested: sql<number>`sum(${refundRequestLines.amountMinor})::int`.as('requested'),
        rules: sql<string[]>`coalesce(array_agg(distinct ${refundRequestLines.decidingRuleId}) filter (where ${refundRequestLines.decidingRuleId} is not null), '{}')`.as('rules'),
      })
      .from(refundRequestLines)
      .groupBy(refundRequestLines.requestId)
      .as('line_summary');

    const conditions: SQL[] = [];
    if (query.view === 'needs-review') conditions.push(eq(decisions.status, 'ESCALATED'), isNull(reviewResolutions.id));
    if (query.status === 'PROCESSING') conditions.push(isNull(decisions.id));
    else if (query.status) conditions.push(eq(decisions.status, query.status));
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      conditions.push(or(ilike(refundRequests.publicId, pattern), ilike(orders.orderNumber, pattern), ilike(customers.email, pattern), ilike(customers.name, pattern))!);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const base = () =>
      this.db
        .select({
          request: refundRequests,
          customerName: customers.name,
          customerEmail: customers.email,
          orderNumber: orders.orderNumber,
          decisionStatus: decisions.status,
          approvedAmountMinor: decisions.approvedAmountMinor,
          escalationReasons: decisions.escalationReasons,
          resolution: reviewResolutions.outcome,
          requested: lineSummary.requested,
          rules: lineSummary.rules,
        })
        .from(refundRequests)
        .innerJoin(customers, eq(customers.id, refundRequests.customerId))
        .innerJoin(orders, eq(orders.id, refundRequests.orderId))
        .leftJoin(decisions, eq(decisions.requestId, refundRequests.id))
        .leftJoin(reviewResolutions, eq(reviewResolutions.requestId, refundRequests.id))
        .leftJoin(lineSummary, eq(lineSummary.requestId, refundRequests.id))
        .where(where);

    const [rows, [{ total }]] = await Promise.all([
      base()
        .orderBy(query.view === 'needs-review' ? asc(refundRequests.createdAt) : desc(refundRequests.createdAt), asc(refundRequests.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(refundRequests)
        .innerJoin(customers, eq(customers.id, refundRequests.customerId))
        .innerJoin(orders, eq(orders.id, refundRequests.orderId))
        .leftJoin(decisions, eq(decisions.requestId, refundRequests.id))
        .leftJoin(reviewResolutions, eq(reviewResolutions.requestId, refundRequests.id))
        .where(where),
    ]);

    return {
      items: rows.map((r) => ({
        requestId: r.request.publicId,
        createdAt: r.request.createdAt.toISOString(),
        source: r.request.source,
        customerName: r.customerName,
        customerEmail: r.customerEmail,
        orderNumber: r.orderNumber,
        reason: r.request.reasonConfirmed,
        requestedAmountMinor: r.requested ?? 0,
        status: r.decisionStatus ?? 'PROCESSING',
        approvedAmountMinor: r.approvedAmountMinor ?? 0,
        reasons: r.decisionStatus === 'ESCALATED' ? (r.escalationReasons ?? []) : [...(r.rules ?? [])].sort(),
        resolution: r.resolution ?? null,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** The full case for one request (by public id), or null. */
  async caseBrief(publicId: string): Promise<CaseBriefDto | null> {
    const [row] = await this.db
      .select({ request: refundRequests, customer: customers, order: orders })
      .from(refundRequests)
      .innerJoin(customers, eq(customers.id, refundRequests.customerId))
      .innerJoin(orders, eq(orders.id, refundRequests.orderId))
      .where(eq(refundRequests.publicId, publicId));
    if (!row) return null;
    const { request, customer, order } = row;

    const [lines, [decisionRow], [resolution], audit, [conversation], transcript, calls] = await Promise.all([
      this.db
        .select({ line: refundRequestLines, item: orderItems })
        .from(refundRequestLines)
        .innerJoin(orderItems, eq(orderItems.id, refundRequestLines.orderItemId))
        .where(eq(refundRequestLines.requestId, request.id))
        .orderBy(asc(orderItems.name)),
      this.db
        .select({ decision: decisions, version: policyVersions.version })
        .from(decisions)
        .innerJoin(policyVersions, eq(policyVersions.id, decisions.policyVersionId))
        .where(eq(decisions.requestId, request.id)),
      this.db.select().from(reviewResolutions).where(eq(reviewResolutions.requestId, request.id)),
      this.db.select().from(auditEvents).where(eq(auditEvents.requestId, request.id)).orderBy(asc(auditEvents.createdAt)),
      request.conversationId ? this.db.select().from(conversations).where(eq(conversations.id, request.conversationId)) : Promise.resolve([]),
      request.conversationId
        ? this.db
            .select()
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, request.conversationId))
            .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.role))
        : Promise.resolve([]),
      this.db
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

  /** Dashboard counters, including seeded demo history. */
  async metrics(now = new Date()): Promise<AdminMetricsDto> {
    const [counts, topEscalationReasons, stuckProcessingCount] = await Promise.all([
      this.countRequests(now),
      this.countEscalationReasons(),
      this.health.countStuckRequests(now),
    ]);
    const { resolvedApproved, resolvedPartiallyApproved, resolvedDenied, ...requests } = counts;
    return {
      generatedAt: now.toISOString(),
      requests,
      resolutions: { approved: resolvedApproved, partiallyApproved: resolvedPartiallyApproved, denied: resolvedDenied },
      topEscalationReasons,
      stuckProcessingCount,
      ai: this.llm.report(),
    };
  }

  protected async countRequests(now: Date) {
    const where = (condition: SQL) => sql<number>`(count(*) filter (where ${condition}))::int`;
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        last24Hours: where(gte(refundRequests.createdAt, new Date(now.getTime() - DAY_MS))),
        processing: where(sql`${decisions.id} is null`),
        approved: where(sql`${decisions.status} = 'APPROVED'`),
        denied: where(sql`${decisions.status} = 'DENIED'`),
        escalated: where(sql`${decisions.status} = 'ESCALATED'`),
        awaitingReview: where(sql`${decisions.status} = 'ESCALATED' and ${reviewResolutions.id} is null`),
        resolvedApproved: where(sql`${reviewResolutions.outcome} = 'APPROVED'`),
        resolvedPartiallyApproved: where(sql`${reviewResolutions.outcome} = 'PARTIALLY_APPROVED'`),
        resolvedDenied: where(sql`${reviewResolutions.outcome} = 'DENIED'`),
      })
      .from(refundRequests)
      .leftJoin(decisions, eq(decisions.requestId, refundRequests.id))
      .leftJoin(reviewResolutions, eq(reviewResolutions.requestId, refundRequests.id));
    return row;
  }

  protected async countEscalationReasons(): Promise<EscalationReasonCountDto[]> {
    const result = await this.db.execute<{ reason: string; count: number }>(sql`
      select reason, count(*)::int as count
      from decisions, unnest(escalation_reasons) as reason
      where status = 'ESCALATED'
      group by reason
      order by count desc, reason asc
      limit ${TOP_REASONS}
    `);
    return result.rows.map(({ reason, count }) => ({ reason, count }));
  }
}
