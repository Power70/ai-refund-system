import { z } from 'zod';
import { POLICY_OUTCOMES } from '../../src/policy/policy.schema.js';
import { REFUND_REASONS } from '../../src/policy/refund-reasons.js';

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
