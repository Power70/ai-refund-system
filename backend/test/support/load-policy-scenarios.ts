import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';
import { policyScenarioSchema, type PolicyScenario } from './policy-scenario.schema.js';

/** Loads policy/scenarios.yaml; a malformed scenario fails loudly instead of being skipped. */
export function loadPolicyScenarios(): PolicyScenario[] {
  const text = readFileSync(new URL('../../../policy/scenarios.yaml', import.meta.url), 'utf8');
  return z.array(policyScenarioSchema).min(1).parse(parse(text, { uniqueKeys: true }));
}
