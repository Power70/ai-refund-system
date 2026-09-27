/**
 * The only facts policy rules may reference. Adding a fact here (and to the fact
 * builder) is the one code change needed to support a new kind of rule.
 * "line" facts describe one requested item; "request" facts describe the whole request.
 */
export type FactScope = 'line' | 'request';
export type FactType = 'boolean' | 'number' | 'string' | 'reason';

export interface FactDefinition {
  scope: FactScope;
  type: FactType;
  nullable: boolean;
}

export const FACT_VOCABULARY = {
  'item.delivered': { scope: 'line', type: 'boolean', nullable: false },
  'item.daysSinceDelivery': { scope: 'line', type: 'number', nullable: true },
  'item.finalSale': { scope: 'line', type: 'boolean', nullable: false },
  'item.category': { scope: 'line', type: 'string', nullable: false },
  'item.priorDeniedRequest': { scope: 'line', type: 'boolean', nullable: false },
  'claim.reason': { scope: 'line', type: 'reason', nullable: false },
  'request.candidateAmountMinor': { scope: 'request', type: 'number', nullable: false },
  'order.refundedOrPendingMinor': { scope: 'request', type: 'number', nullable: false },
  'request.cumulativeOrderRefundMinor': { scope: 'request', type: 'number', nullable: false },
  'customer.requestsLast30Days': { scope: 'request', type: 'number', nullable: false },
} as const satisfies Record<string, FactDefinition>;

export type FactName = keyof typeof FACT_VOCABULARY;
export type FactValue = boolean | number | string | null;
export type FactValues = Partial<Record<FactName, FactValue>>;

export function isFactName(name: string): name is FactName {
  return Object.hasOwn(FACT_VOCABULARY, name);
}
