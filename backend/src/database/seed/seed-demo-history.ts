import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { evaluateRequest } from '../../policy/evaluate-request.js';
import type { RegisteredPolicy } from '../../policy/registry/active-policy.types.js';
import { canonicalJson } from '../../policy/registry/canonical-json.js';
import { buildRequestFacts } from '../../refunds/facts/build-request-facts.js';
import { finalLineStatuses } from '../../refunds/final-line-statuses.js';
import { templateCustomerMessage } from '../../refunds/messages/template-customer-message.js';
import type { Database } from '../database.types.js';
import * as schema from '../schema/index.js';
import { DEMO_HISTORY } from './demo-history.js';
import type { DemoHistoryEntry } from './demo-history.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface HistorySummary {
  created: number;
  refreshed: number;
}

/**
 * Loads the demo refund history. New entries are decided by the real fact builder and
 * policy engine; existing ones only get their timestamps moved relative to `now`, so they
 * stay consistent with the catalog's refreshed delivery dates. Decisions are never re-made.
 * Seeded rows are marked source = SEED and have no audit events (the audit log is append-only
 * and can't be re-dated; the admin view labels them as demo history).
 */
export async function seedDemoHistory(
  db: Database,
  policy: RegisteredPolicy,
  now: Date,
  history: readonly DemoHistoryEntry[] = DEMO_HISTORY,
): Promise<HistorySummary> {
  const summary: HistorySummary = { created: 0, refreshed: 0 };

  await db.transaction(async (tx) => {
    for (const entry of history) {
      const at = new Date(now.getTime() - entry.daysAgo * DAY_MS);
      const [existing] = await tx.select({ id: schema.refundRequests.id }).from(schema.refundRequests).where(eq(schema.refundRequests.publicId, entry.publicId));
      if (existing) {
        await redate(tx, existing.id, entry, at);
        summary.refreshed++;
      } else {
        await create(tx, policy, entry, at);
        summary.created++;
      }
    }
  });
  return summary;
}

async function create(tx: Database, policy: RegisteredPolicy, entry: DemoHistoryEntry, at: Date): Promise<void> {
  const [order] = await tx
    .select({ id: schema.orders.id, customerId: schema.orders.customerId })
    .from(schema.orders)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
    .where(and(eq(schema.orders.orderNumber, entry.orderNumber), eq(schema.customers.email, entry.customerEmail)));
  if (!order) throw new Error(`Demo history ${entry.publicId}: order ${entry.orderNumber} not found for ${entry.customerEmail}`);

  const items = await tx
    .select({ id: schema.orderItems.id, sku: schema.orderItems.sku })
    .from(schema.orderItems)
    .where(and(eq(schema.orderItems.orderId, order.id), inArray(schema.orderItems.sku, entry.lines.map((l) => l.sku))));
  const idBySku = new Map(items.map((i) => [i.sku, i.id]));
  const lines = entry.lines.map((l) => {
    const orderItemId = idBySku.get(l.sku);
    if (!orderItemId) throw new Error(`Demo history ${entry.publicId}: SKU ${l.sku} not in ${entry.orderNumber}`);
    return { orderItemId, quantity: l.quantity };
  });

  const facts = await buildRequestFacts(tx, { customerId: order.customerId, orderId: order.id, reason: entry.reason, lines, at });
  const evaluation = evaluateRequest(policy.document, facts.lines, facts.history);
  const statuses = finalLineStatuses(evaluation);
  const claim = { orderId: order.id, reason: entry.reason, lines: [...lines].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)) };

  const [request] = await tx
    .insert(schema.refundRequests)
    .values({
      publicId: entry.publicId,
      customerId: order.customerId,
      orderId: order.id,
      policyVersionId: policy.id,
      idempotencyKey: `seed:${entry.publicId}`,
      payloadHash: createHash('sha256').update(canonicalJson(claim)).digest('hex'),
      reasonConfirmed: entry.reason,
      source: 'SEED',
      state: 'DECIDED',
      createdAt: at,
      updatedAt: at,
    })
    .returning({ id: schema.refundRequests.id });

  const lineRows = await tx
    .insert(schema.refundRequestLines)
    .values(
      evaluation.lines.map((line) => ({
        requestId: request.id,
        orderId: order.id,
        orderItemId: line.lineId,
        quantity: lines.find((l) => l.orderItemId === line.lineId)!.quantity,
        amountMinor: line.amountMinor,
        lineOutcome: line.outcome,
        decidingRuleId: line.decidingRuleId,
        finalLineStatus: statuses.get(line.lineId)!,
      })),
    )
    .returning({ id: schema.refundRequestLines.id, orderItemId: schema.refundRequestLines.orderItemId, amountMinor: schema.refundRequestLines.amountMinor });

  await tx.insert(schema.decisions).values({
    requestId: request.id,
    status: evaluation.status,
    approvedAmountMinor: evaluation.approvedAmountMinor,
    policyVersionId: policy.id,
    ruleTrace: evaluation,
    escalationReasons: evaluation.escalationRuleIds,
    customerMessage: templateCustomerMessage(evaluation, policy.document.reviewEtaBusinessDays),
    messageSource: 'TEMPLATE',
    createdAt: at,
  });

  if (entry.resolution && evaluation.status === 'ESCALATED') {
    const skuByItem = new Map(items.map((i) => [i.id, i.sku]));
    const decided = lineRows.map((row) => ({ row, approve: entry.resolution!.approveSkus.includes(skuByItem.get(row.orderItemId)!) }));
    const approvedAmount = decided.filter((d) => d.approve).reduce((sum, d) => sum + d.row.amountMinor, 0);
    const approvedCount = decided.filter((d) => d.approve).length;
    const outcome = approvedCount === 0 ? 'DENIED' : approvedCount === decided.length ? 'APPROVED' : 'PARTIALLY_APPROVED';

    await tx.insert(schema.reviewResolutions).values({
      requestId: request.id,
      outcome,
      lineDecisions: decided.map((d) => ({ lineId: d.row.id, approve: d.approve })),
      approvedAmountMinor: approvedAmount,
      reviewerNote: entry.resolution.note,
      customerMessage:
        outcome === 'DENIED'
          ? 'Our team reviewed your request and could not approve a refund.'
          : 'Our team reviewed your request and approved a refund.',
      createdAt: new Date(at.getTime() + entry.resolution.daysAfter * DAY_MS),
    });
    for (const d of decided) {
      await tx
        .update(schema.refundRequestLines)
        .set({ finalLineStatus: d.approve ? 'REFUNDED' : 'NOT_REFUNDED' })
        .where(eq(schema.refundRequestLines.id, d.row.id));
    }
  }
}

async function redate(tx: Database, requestId: string, entry: DemoHistoryEntry, at: Date): Promise<void> {
  await tx.update(schema.refundRequests).set({ createdAt: at, updatedAt: at }).where(eq(schema.refundRequests.id, requestId));
  await tx.update(schema.decisions).set({ createdAt: at }).where(eq(schema.decisions.requestId, requestId));
  if (entry.resolution) {
    await tx
      .update(schema.reviewResolutions)
      .set({ createdAt: new Date(at.getTime() + entry.resolution.daysAfter * DAY_MS) })
      .where(eq(schema.reviewResolutions.requestId, requestId));
  }
}
