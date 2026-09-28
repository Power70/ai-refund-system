import type { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import type { Env } from '../config/env.js';
import type { Database } from '../database/database.providers.js';
import type { refundRequests } from '../database/schema.js';
import { parsePolicy } from '../policy/policy-schema.js';
import type { PolicyService, RegisteredPolicy } from '../policy/policy.service.js';
import type { CustomerMessagesService } from './customer-messages.service.js';
import type { DecisionPlan } from './decision.rules.js';
import { DecisionService, LEASE_MS, newLease } from './decision.service.js';
import type { RequestFactsService } from './request-facts.service.js';

const document = parsePolicy(readFileSync(new URL('../../../policy/refund-policy.yaml', import.meta.url), 'utf8'));
const policy: RegisteredPolicy = { id: 'policy-1', version: document.version, contentHash: 'hash', effectiveFrom: new Date(document.effectiveFrom), document };
const request = {
  id: 'req-1', publicId: 'rr_abcdefghjkmn', customerId: 'cust-1', orderId: 'order-1', policyVersionId: 'policy-1', reasonConfirmed: 'DAMAGED',
  createdAt: new Date('2026-09-20T10:00:00Z'), claimContext: null, aiProposal: null, conversationId: null,
} as unknown as typeof refundRequests.$inferSelect;

class TestDecisionService extends DecisionService {
  leasedRequest = vi.fn(async () => request as typeof request | null);
  loadContext = vi.fn(async () => ({ lines: [{ orderItemId: 'item-1', quantity: 1 }] as never, customerName: 'Ada Okafor', currency: 'USD', itemNames: new Map([['item-1', 'Oxford shirt']]) }));
  record = vi.fn(async () => true);
}

function setup() {
  const policies = { policyById: vi.fn(async () => policy) };
  const facts = {
    build: vi.fn(async () => ({
      lines: [{ lineId: 'item-1', amountMinor: 4999, facts: { 'item.delivered': true, 'item.daysSinceDelivery': 3, 'item.finalSale': false, 'item.category': 'APPAREL', 'item.priorDeniedRequest': false, 'claim.reason': 'DAMAGED' } }],
      history: { 'order.refundedOrPendingMinor': 0, 'customer.requestsLast30Days': 0 },
    })),
  };
  const messages = { writeDecisionReply: vi.fn(async () => ({ text: 'reply', source: 'TEMPLATE' as const, call: null })) };
  const config = { get: vi.fn(() => 0.95) };
  const service = new TestDecisionService(
    {} as Database,
    policies as unknown as PolicyService,
    facts as unknown as RequestFactsService,
    messages as unknown as CustomerMessagesService,
    config as unknown as ConfigService<Env, true>,
  );
  return { service, policies, facts, messages };
}

describe('newLease', () => {
  it('gives each attempt a unique owner and a fixed expiry', () => {
    const now = new Date('2026-09-27T12:00:00Z');
    const [a, b] = [newLease(now), newLease(now)];
    expect(a.leaseOwner).not.toBe(b.leaseOwner);
    expect(a.leaseExpiresAt.getTime() - now.getTime()).toBe(LEASE_MS);
  });
});

describe('DecisionService.decide', () => {
  it('does nothing without the lease', async () => {
    const { service, facts, messages } = setup();
    service.leasedRequest.mockResolvedValue(null);
    await expect(service.decide('req-1', 'someone-else')).resolves.toBe(false);
    expect(facts.build).not.toHaveBeenCalled();
    expect(messages.writeDecisionReply).not.toHaveBeenCalled();
    expect(service.record).not.toHaveBeenCalled();
  });

  it('judges the request as of its submission, excluding itself from its history', async () => {
    const { service, facts, policies } = setup();
    await service.decide('req-1', 'owner');
    expect(policies.policyById).toHaveBeenCalledWith('policy-1');
    expect(facts.build).toHaveBeenCalledWith(expect.objectContaining({ at: request.createdAt, excludeRequestId: 'req-1', reason: 'DAMAGED', lines: [{ orderItemId: 'item-1', quantity: 1 }] }));
  });

  it('writes the message from the gated plan and stores it under the same lease', async () => {
    const { service, messages } = setup();
    await expect(service.decide('req-1', 'owner')).resolves.toBe(true);

    const plan = (service.record.mock.calls[0] as unknown as [unknown, string, RegisteredPolicy, DecisionPlan])[3];
    expect(plan.gate).toEqual({ status: 'ESCALATED', reasons: ['NO_AI_ASSESSMENT'] });
    expect(messages.writeDecisionReply).toHaveBeenCalledWith(plan.brief);
    expect(service.record).toHaveBeenCalledWith(request, 'owner', policy, plan, { text: 'reply', source: 'TEMPLATE', call: null });
  });

  it('reports a lost lease from the final write', async () => {
    const { service } = setup();
    service.record.mockResolvedValue(false);
    await expect(service.decide('req-1', 'owner')).resolves.toBe(false);
  });
});
