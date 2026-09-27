import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../database/database.types.js';
import { customers, decisions, orders, refundRequestLines, refundRequests, reviewResolutions } from '../database/schema/index.js';
import type { AdminQueueQueryDto } from './dto/admin-queue-query.dto.js';
import type { AdminQueueDto } from './dto/admin-queue.dto.js';
import { escapeLike } from './escape-like.js';

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
