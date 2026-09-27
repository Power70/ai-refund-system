import type { PolicyOutcome } from './policy.schema.js';

/** Returns the outcome listed earliest in the policy's precedence, or null for an empty list. */
export function pickByPrecedence(
  outcomes: readonly PolicyOutcome[],
  precedence: readonly PolicyOutcome[],
): PolicyOutcome | null {
  for (const candidate of precedence) {
    if (outcomes.includes(candidate)) return candidate;
  }
  return null;
}
