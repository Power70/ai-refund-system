import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { Env } from '../config/env.js';
import { DATABASE, type Database } from '../database/database.providers.js';
import { aiCalls, auditEvents, customers, decisions, orderItems, orders, refundRequestLines, refundRequests } from '../database/schema.js';
import { PolicyService, type RegisteredPolicy } from '../policy/policy.service.js';
import { CustomerMessagesService, SYSTEM_FAILURE_CUSTOMER_MESSAGE, type GeneratedReply } from './customer-messages.service.js';
import { planDecision, type DecisionPlan } from './decision.rules.js';
import { RequestFactsService } from './request-facts.service.js';

export const LEASE_MS = 60_000;

export interface Lease {
  leaseOwner: string;
  leaseExpiresAt: Date;
}

export function newLease(now = new Date()): Lease {
  return { leaseOwner: `${hostname()}:${process.pid}:${randomUUID()}`, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) };
}

type RefundRequestRow = typeof refundRequests.$inferSelect;
type RequestLineRow = typeof refundRequestLines.$inferSelect;

/**
 * Decides reserved requests. Every finishing write is conditional on holding the lease,
 * so a worker whose lease was taken over can never store a second decision.
 */
@Injectable()
export class DecisionService {
  private readonly minConfidence: number;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly policies: PolicyService,
    private readonly facts: RequestFactsService,
    private readonly messages: CustomerMessagesService,
    config: ConfigService<Env, true>,
  ) {
    this.minConfidence = config.get('AI_MIN_CONFIDENCE', { infer: true });
  }

  /** Decides and stores a reserved request (transaction 2). Returns false, writing nothing, if the lease is lost. */
  async decide(requestId: string, leaseOwner: string): Promise<boolean> {
    const request = await this.leasedRequest(requestId, leaseOwner);
    if (!request) return false;

    const { lines, customerName, currency, itemNames } = await this.loadContext(request);
    const policy = await this.policies.policyById(request.policyVersionId);
    const facts = await this.facts.build({
      customerId: request.customerId,
      orderId: request.orderId,
      reason: request.reasonConfirmed,
      lines: lines.map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })),
      at: request.createdAt,
      excludeRequestId: request.id,
    });
    const plan = planDecision({ request, lines, policy, facts, customerName, currency, itemNames, minConfidence: this.minConfidence });
    // Written before transaction 2 so no transaction stays open during the model call.
    const reply = await this.messages.writeDecisionReply(plan.brief);
    return this.record(request, leaseOwner, policy, plan, reply);
  }

  /** Compare-and-set takeover of an expired lease: among racing callers exactly one gets the lease, others null. */
  async reclaimExpiredLease(requestId: string, now = new Date()): Promise<string | null> {
    const lease = newLease(now);
    const [row] = await this.db
      .update(refundRequests)
      .set({ ...lease, attemptCount: sql`${refundRequests.attemptCount} + 1`, updatedAt: now })
      .where(and(eq(refundRequests.id, requestId), eq(refundRequests.state, 'PROCESSING'), lt(refundRequests.leaseExpiresAt, now)))
      .returning({ attemptCount: refundRequests.attemptCount });
    if (!row) return null;
    await this.db.insert(auditEvents).values({ requestId, type: 'PROCESSING_RESUMED', actor: 'SYSTEM', data: { attempt: row.attemptCount }, createdAt: now });
    return lease.leaseOwner;
  }

  /** Escalates after repeated processing failures (no rule trace; lines stay reserved). Lease-guarded. */
  async escalateAfterSystemFailure(requestId: string, leaseOwner: string, attempts: number): Promise<boolean> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const claimed = await this.finish(tx, requestId, leaseOwner, now);
      if (!claimed) return false;

      await tx.insert(decisions).values({
        requestId,
        status: 'ESCALATED',
        approvedAmountMinor: 0,
        policyVersionId: claimed.policyVersionId,
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

  /** The request, if it is still processing under this lease. */
  protected async leasedRequest(requestId: string, leaseOwner: string): Promise<RefundRequestRow | null> {
    const [request] = await this.db.select().from(refundRequests).where(eq(refundRequests.id, requestId));
    return request?.state === 'PROCESSING' && request.leaseOwner === leaseOwner ? request : null;
  }

  protected async loadContext(request: RefundRequestRow): Promise<{ lines: RequestLineRow[]; customerName: string; currency: string; itemNames: Map<string, string> }> {
    const [lines, [who], items] = await Promise.all([
      this.db.select().from(refundRequestLines).where(eq(refundRequestLines.requestId, request.id)),
      this.db
        .select({ name: customers.name, currency: orders.currency })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .where(eq(orders.id, request.orderId)),
      this.db.select({ id: orderItems.id, name: orderItems.name }).from(orderItems).where(eq(orderItems.orderId, request.orderId)),
    ]);
    return { lines, customerName: who.name, currency: who.currency, itemNames: new Map(items.map((i) => [i.id, i.name])) };
  }

  /** Transaction 2: stores the decision, line outcomes and audit trail if the lease still holds. */
  protected async record(request: RefundRequestRow, leaseOwner: string, policy: RegisteredPolicy, plan: DecisionPlan, reply: GeneratedReply): Promise<boolean> {
    const { evaluation, gate, assessment, statuses, approvedAmountMinor } = plan;
    const requestId = request.id;
    const now = new Date();

    return this.db.transaction(async (tx) => {
      if (!(await this.finish(tx, requestId, leaseOwner, now))) return false;

      await tx.insert(decisions).values({
        requestId,
        status: gate.status,
        approvedAmountMinor,
        policyVersionId: policy.id,
        ruleTrace: evaluation,
        gateResult: { policyStatus: evaluation.status, ...gate, assessment: assessment.kind },
        escalationReasons: [...evaluation.escalationRuleIds, ...gate.reasons],
        customerMessage: reply.text,
        messageSource: reply.source,
        createdAt: now,
      });
      if (reply.call) await tx.insert(aiCalls).values({ ...reply.call, kind: 'DECISION_REPLY', requestId, conversationId: request.conversationId, createdAt: now });
      for (const line of evaluation.lines) {
        await tx
          .update(refundRequestLines)
          .set({ lineOutcome: line.outcome, decidingRuleId: line.decidingRuleId, finalLineStatus: statuses.get(line.lineId)! })
          .where(and(eq(refundRequestLines.requestId, requestId), eq(refundRequestLines.orderItemId, line.lineId)));
      }
      await tx.insert(auditEvents).values([
        {
          requestId,
          type: 'POLICY_EVALUATED',
          actor: 'SYSTEM',
          data: { policyVersion: policy.version, status: evaluation.status, escalationRuleIds: evaluation.escalationRuleIds, approvedAmountMinor: evaluation.approvedAmountMinor },
          createdAt: now,
        },
        { requestId, type: 'SAFETY_GATE_APPLIED', actor: 'SYSTEM', data: { status: gate.status, reasons: gate.reasons, assessment: assessment.kind }, createdAt: now },
        { requestId, type: 'DECISION_RECORDED', actor: 'SYSTEM', data: { status: gate.status, approvedAmountMinor, messageSource: reply.source }, createdAt: now },
      ]);
      return true;
    });
  }

  /** Marks the request DECIDED and releases the lease, only while `leaseOwner` holds it. */
  private async finish(tx: Database, requestId: string, leaseOwner: string, now: Date): Promise<{ policyVersionId: string } | undefined> {
    const [claimed] = await tx
      .update(refundRequests)
      .set({ state: 'DECIDED', leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
      .where(and(eq(refundRequests.id, requestId), eq(refundRequests.state, 'PROCESSING'), eq(refundRequests.leaseOwner, leaseOwner)))
      .returning({ policyVersionId: refundRequests.policyVersionId });
    return claimed;
  }
}
