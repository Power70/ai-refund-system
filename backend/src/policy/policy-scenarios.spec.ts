import { readFileSync } from 'node:fs';
import { loadPolicyScenarios } from '../../test/support/load-policy-scenarios.js';
import { scenarioToEngineInput } from '../../test/support/scenario-to-engine-input.js';
import { evaluateRequest } from './evaluate-request.js';
import { parsePolicy } from './parse-policy.js';

const policy = parsePolicy(readFileSync(new URL('../../../policy/refund-policy.yaml', import.meta.url), 'utf8'));
const scenarios = loadPolicyScenarios();

describe('refund policy scenarios (policy/scenarios.yaml)', () => {
  it.each(scenarios.map((s) => [s.name, s] as const))('%s', (_name, scenario) => {
    const { lines, history } = scenarioToEngineInput(scenario);
    const result = evaluateRequest(policy, lines, history);

    expect({
      status: result.status,
      approved: result.approvedAmountMinor,
      items: result.lines.map((l) => l.outcome),
      rules: result.lines.map((l) => l.decidingRuleId ?? 'DEFAULT'),
    }).toEqual({
      status: scenario.expect.status,
      approved: scenario.expect.approved,
      items: scenario.expect.items,
      rules: scenario.expect.rules,
    });

    if (scenario.expect.requestRules) {
      const matched = result.requestTrace.filter((t) => t.matched).map((t) => t.ruleId);
      expect(matched).toEqual(scenario.expect.requestRules);
    }
  });

  it('every policy rule is exercised by at least one scenario', () => {
    const exercised = new Set(
      scenarios.flatMap((s) => [...s.expect.rules, ...(s.expect.requestRules ?? [])]),
    );
    const allRules = [...policy.lineRules, ...policy.requestRules].map((r) => r.id);
    expect(allRules.filter((id) => !exercised.has(id))).toEqual([]);
  });
});
