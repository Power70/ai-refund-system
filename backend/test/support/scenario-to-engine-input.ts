import type { LineInput, RequestHistoryFacts } from '../../src/policy/policy-evaluation.types.js';
import type { PolicyScenario } from './policy-scenario.schema.js';

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
