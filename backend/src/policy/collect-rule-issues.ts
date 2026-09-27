import { checkConditionTypes, type ConditionIssue } from './check-condition-types.js';
import { REFUND_REASONS } from './refund-reasons.js';

/**
 * Semantic checks over the rule lists: duplicate ids and every condition's facts,
 * scopes, operators and values. Accepts unvalidated input on purpose, so these
 * problems are reported even when other parts of the file are also broken.
 */
export function collectRuleIssues(raw: unknown): ConditionIssue[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const policy = raw as Record<string, unknown>;
  const reasons = Array.isArray(policy.reasons)
    ? policy.reasons.filter((r): r is string => (REFUND_REASONS as readonly unknown[]).includes(r))
    : [];

  const issues: ConditionIssue[] = [];
  const seenIds = new Set<string>();
  for (const [group, scope] of [['lineRules', 'line'], ['requestRules', 'request']] as const) {
    const rules = policy[group];
    if (!Array.isArray(rules)) continue;
    rules.forEach((rule: unknown, i) => {
      if (typeof rule !== 'object' || rule === null) return;
      const { id, when } = rule as { id?: unknown; when?: unknown };
      if (typeof id === 'string') {
        if (seenIds.has(id)) issues.push({ path: [group, i, 'id'], message: `duplicate rule id "${id}"` });
        seenIds.add(id);
      }
      for (const issue of checkConditionTypes(when, scope, reasons)) {
        issues.push({ path: [group, i, 'when', ...issue.path], message: issue.message });
      }
    });
  }
  return issues;
}
