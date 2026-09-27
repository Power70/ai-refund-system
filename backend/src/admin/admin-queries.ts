import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL, gte } from 'drizzle-orm';
import type { AiStatusReport } from '../ai/llm.types.js';
import type { CaseSummary } from '../conversations/case-summary.js';
import type { ProposalRecord } from '../conversations/chat-turn.js';
import type { Database } from '../database/database.js';
import { customers, decisions, orders, refundRequestLines, refundRequests, reviewResolutions, aiCalls, auditEvents, conversationMessages, conversations, orderItems, policyVersions } from '../database/schema.js';
import { countStuckRequests } from '../refunds/request-sweeper.js';
import type { AdminQueueQueryDto, AdminQueueDto, CaseBriefDto, AdminMetricsDto, EscalationReasonCountDto, AdminHealthDto } from './admin.dto.js';

/** Escapes LIKE wildcards so user search text matches literally (default escape char: backslash). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The support queue. "needs-review" = escalations nobody has resolved yet, oldest first
 * (so none are forgotten); "all" = everything, newest first. One query per page plus a count.
 */
export async function listAdminQueue(db: Database, query: AdminQueueQueryDto): Promise<AdminQueueDto> {
  const lineSummary = db
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
    db
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
    db
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

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_REASONS = 10;

/** Dashboard counters, including seeded demo history. */
export async function loadAdminMetrics(db: Database, ai: AiStatusReport, now = new Date()): Promise<AdminMetricsDto> {
  const [counts, topEscalationReasons, stuckProcessingCount] = await Promise.all([
    countRequests(db, now),
    countEscalationReasons(db),
    countStuckRequests(db, now),
  ]);
  const { resolvedApproved, resolvedPartiallyApproved, resolvedDenied, ...requests } = counts;
  return {
    generatedAt: now.toISOString(),
    requests,
    resolutions: { approved: resolvedApproved, partiallyApproved: resolvedPartiallyApproved, denied: resolvedDenied },
    topEscalationReasons,
    stuckProcessingCount,
    ai,
  };
}

async function countRequests(db: Database, now: Date) {
  const where = (condition: SQL) => sql<number>`(count(*) filter (where ${condition}))::int`;
  const [row] = await db
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

async function countEscalationReasons(db: Database): Promise<EscalationReasonCountDto[]> {
  const result = await db.execute<{ reason: string; count: number }>(sql`
    select reason, count(*)::int as count
    from decisions, unnest(escalation_reasons) as reason
    where status = 'ESCALATED'
    group by reason
    order by count desc, reason asc
    limit ${TOP_REASONS}
  `);
  return result.rows.map(({ reason, count }) => ({ reason, count }));
}

export interface HealthProbes {
  databaseReachable: () => Promise<boolean>;
  activePolicyVersion: () => Promise<string>;
  stuckCount: () => Promise<number>;
  ai: () => AiStatusReport;
}

/** Detailed health for admins. Never throws; probe failures are reported as values. */
export async function checkAdminHealth(probes: HealthProbes, now = new Date()): Promise<AdminHealthDto> {
  const ai = probes.ai();
  const reachable = await probes.databaseReachable();
  const [policyVersion, stuckProcessingCount] = reachable
    ? await Promise.all([probes.activePolicyVersion().catch(() => null), probes.stuckCount().catch(() => null)])
    : [null, null];

  const healthy = reachable && ai.status !== 'degraded' && policyVersion !== null && stuckProcessingCount === 0;
  return {
    status: healthy ? 'ok' : 'degraded',
    database: reachable ? 'ok' : 'unreachable',
    ai,
    policyVersion,
    stuckProcessingCount,
    checkedAt: now.toISOString(),
  };
}
