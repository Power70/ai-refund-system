import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createHash } from 'node:crypto';
import { deriveResolution } from '../../admin/admin-resolution.js';
import { evaluateRequest } from '../../policy/policy-engine.js';
import { canonicalJson, type RegisteredPolicy } from '../../policy/policy-registry.js';
import { finalLineStatuses } from '../../refunds/decide-request.js';
import { buildRequestFacts } from '../../refunds/refund-facts.js';
import { resolutionCustomerMessage, templateCustomerMessage } from '../../refunds/refund-messages.js';
import type { Database } from '../database.js';
import * as schema from '../schema.js';
import { DEMO_CATALOG, demoOrderDates, DEMO_HISTORY, type DemoCustomer, type DemoHistoryEntry } from './demo-data.js';

export interface SeedSummary {
  customers: number;
  orders: number;
  items: number;
}

/**
 * Upserts the demo customers, orders and items in one transaction.
 * Safe to run on every startup: existing rows are updated (dates refreshed relative to
 * `now` so every scenario keeps working), nothing is duplicated, and rows that are not
 * part of the demo catalog are never touched.
 */
export async function seedDemoCatalog(
  db: NodePgDatabase<typeof schema>,
  now: Date,
  catalog: readonly DemoCustomer[] = DEMO_CATALOG,
): Promise<SeedSummary> {
  const summary: SeedSummary = { customers: 0, orders: 0, items: 0 };

  await db.transaction(async (tx) => {
    for (const demo of catalog) {
      const [customer] = await tx
        .insert(schema.customers)
        .values({ name: demo.name, email: demo.email.toLowerCase() })
        .onConflictDoUpdate({ target: schema.customers.email, set: { name: demo.name } })
        .returning({ id: schema.customers.id });
      summary.customers++;

      for (const demoOrder of demo.orders) {
        const dates = demoOrderDates(demoOrder.deliveredDaysAgo, now);
        const [order] = await tx
          .insert(schema.orders)
          .values({ orderNumber: demoOrder.orderNumber, customerId: customer.id, currency: 'USD', ...dates })
          .onConflictDoUpdate({
            target: schema.orders.orderNumber,
            set: { customerId: customer.id, placedAt: dates.placedAt, deliveredAt: dates.deliveredAt },
          })
          .returning({ id: schema.orders.id });
        summary.orders++;

        for (const item of demoOrder.items) {
          const values = { ...item, finalSale: item.finalSale ?? false };
          await tx
            .insert(schema.orderItems)
            .values({ orderId: order.id, ...values })
            .onConflictDoUpdate({
              target: [schema.orderItems.orderId, schema.orderItems.sku],
              set: {
                name: values.name,
                category: values.category,
                unitPricePaidMinor: values.unitPricePaidMinor,
                quantity: values.quantity,
                finalSale: values.finalSale,
              },
            });
          summary.items++;
        }
      }
    }
  });

  return summary;
}

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
    .select({ id: schema.orders.id, customerId: schema.orders.customerId, currency: schema.orders.currency })
    .from(schema.orders)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
    .where(and(eq(schema.orders.orderNumber, entry.orderNumber), eq(schema.customers.email, entry.customerEmail)));
  if (!order) throw new Error(`Demo history ${entry.publicId}: order ${entry.orderNumber} not found for ${entry.customerEmail}`);

  const items = await tx
    .select({ id: schema.orderItems.id, sku: schema.orderItems.sku, name: schema.orderItems.name })
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
    customerMessage: templateCustomerMessage(evaluation.status, evaluation.lines, policy.document.reviewEtaBusinessDays),
    messageSource: 'TEMPLATE',
    createdAt: at,
  });

  if (entry.resolution && evaluation.status === 'ESCALATED') {
    const skuByItem = new Map(items.map((i) => [i.id, i.sku]));
    const nameByItem = new Map(items.map((i) => [i.id, i.name]));
    const approveSkus = entry.resolution.approveSkus;
    const decided = lineRows.map((row) => ({ row, approve: approveSkus.includes(skuByItem.get(row.orderItemId)!) }));
    const resolution = deriveResolution(
      lineRows.map((row) => ({ id: row.id, amountMinor: row.amountMinor })),
      decided.map((d) => ({ lineId: d.row.id, approve: d.approve })),
    )!;

    await tx.insert(schema.reviewResolutions).values({
      requestId: request.id,
      outcome: resolution.outcome,
      lineDecisions: resolution.lineDecisions,
      approvedAmountMinor: resolution.approvedAmountMinor,
      reviewerNote: entry.resolution.note,
      customerMessage: resolutionCustomerMessage(
        resolution.outcome,
        decided.map((d) => ({ itemName: nameByItem.get(d.row.orderItemId)!, approve: d.approve })),
        resolution.approvedAmountMinor,
        order.currency,
      ),
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
