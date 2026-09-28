import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';
import type { Database } from '../../src/database/database.providers.js';
import type { LineInput, RequestHistoryFacts } from '../../src/policy/policy-engine.js';
import { POLICY_OUTCOMES, REFUND_REASONS, type PolicyDocument } from '../../src/policy/policy-schema.js';
import { PolicyService } from '../../src/policy/policy.service.js';

/** The real policy/refund-policy.yaml. */
export const REAL_POLICY_PATH = new URL('../../../policy/refund-policy.yaml', import.meta.url).pathname;

/** A PolicyService outside Nest, reading the real policy file. */
export const policyService = (db: Database) => new PolicyService(db, REAL_POLICY_PATH);

/** A small valid policy for registry tests; vary version/effectiveFrom/threshold per case. */
export function policyDocument(version: string, effectiveFrom: string, windowDays = 30): PolicyDocument {
  return {
    version,
    effectiveFrom,
    currency: 'USD',
    reviewEtaBusinessDays: 2,
    precedence: ['DENY', 'REVIEW', 'ALLOW'],
    defaultOutcome: 'REVIEW',
    defaultPublicReason: 'A team member will review this request.',
    reasons: ['DAMAGED', 'OTHER'],
    lineRules: [
      {
        id: 'WINDOW_EXPIRED',
        when: { fact: 'item.daysSinceDelivery', op: 'gt', value: windowDays },
        outcome: 'DENY',
        publicReason: 'Too late.',
      },
    ],
    requestRules: [],
  };
}

const cents = z.number().int().min(0);

export const policyScenarioSchema = z.strictObject({
  name: z.string().min(1),
  reason: z.enum(REFUND_REASONS),
  history: z
    .strictObject({ refundedOrPending: cents.default(0), requestsLast30Days: cents.default(0) })
    .default({ refundedOrPending: 0, requestsLast30Days: 0 }),
  items: z
    .array(
      z.strictObject({
        amount: cents,
        daysSinceDelivery: z.number().int().min(0).nullable(),
        finalSale: z.boolean().default(false),
        priorDenied: z.boolean().default(false),
        category: z.string().default('general'),
      }),
    )
    .min(1),
  expect: z.strictObject({
    status: z.enum(['APPROVED', 'DENIED', 'ESCALATED']),
    approved: cents,
    items: z.array(z.enum(POLICY_OUTCOMES)),
    rules: z.array(z.string()),
    requestRules: z.array(z.string()).optional(),
  }),
});

export type PolicyScenario = z.infer<typeof policyScenarioSchema>;

/** Loads policy/scenarios.yaml; a malformed scenario fails loudly instead of being skipped. */
export function loadPolicyScenarios(): PolicyScenario[] {
  const text = readFileSync(new URL('../../../policy/scenarios.yaml', import.meta.url), 'utf8');
  return z.array(policyScenarioSchema).min(1).parse(parse(text, { uniqueKeys: true }));
}

/** Turns a readable scenario into exactly the facts the fact builder will supply in production. */
export function scenarioToEngineInput(scenario: PolicyScenario): { lines: LineInput[]; history: RequestHistoryFacts } {
  const lines = scenario.items.map((item, index) => ({
    lineId: `line-${index + 1}`,
    amountMinor: item.amount,
    facts: {
      'item.delivered': item.daysSinceDelivery !== null,
      'item.daysSinceDelivery': item.daysSinceDelivery,
      'item.finalSale': item.finalSale,
      'item.category': item.category,
      'item.priorDeniedRequest': item.priorDenied,
      'claim.reason': scenario.reason,
    },
  }));
  return {
    lines,
    history: {
      'order.refundedOrPendingMinor': scenario.history.refundedOrPending,
      'customer.requestsLast30Days': scenario.history.requestsLast30Days,
    },
  };
}
