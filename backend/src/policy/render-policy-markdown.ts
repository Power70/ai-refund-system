import { describeCondition } from './describe-condition.js';
import { REASON_LABELS } from './fact-labels.js';
import type { PolicyDocument, PolicyOutcome, PolicyRule } from './policy.schema.js';

const OUTCOME_LABELS: Record<PolicyOutcome, string> = {
  ALLOW: 'Approved',
  DENY: 'Denied',
  REVIEW: 'Needs review',
};

export const GENERATED_NOTICE =
  '<!-- GENERATED from refund-policy.yaml by `npm run policy:docs` (in backend/). Do not edit by hand. -->';

/**
 * Renders the policy as the customer- and staff-readable document. Deterministic:
 * the same YAML always gives byte-identical output, so a test can detect drift.
 */
export function renderPolicyMarkdown(policy: PolicyDocument): string {
  const effective = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(policy.effectiveFrom),
  );
  const order = policy.precedence.map((o) => OUTCOME_LABELS[o]).join(', then ');

  const lines = [
    GENERATED_NOTICE,
    '',
    '# Refund Policy',
    '',
    `Version **${policy.version}** · effective ${effective} · amounts in ${policy.currency}`,
    '',
    '## How decisions are made',
    '',
    `- A customer can give one of these reasons: ${policy.reasons.map((r) => REASON_LABELS[r]).join(', ')}.`,
    '- Each item in a request is checked against every item rule below.',
    `- If more than one rule applies to an item, the outcome is chosen in this order: ${order}.`,
    `- If no rule applies to an item, it is **${OUTCOME_LABELS[policy.defaultOutcome]}**: "${escapeCell(policy.defaultPublicReason)}"`,
    '- If every item is denied, the request is denied. Otherwise the whole-request rules are checked too.',
    '- If any item or whole-request rule needs review, a member of the team decides the whole request.',
    `- Requests that need review are answered within ${policy.reviewEtaBusinessDays} business days.`,
    '',
    '## Item rules',
    '',
    ...ruleTable(policy.lineRules, policy.currency),
    '',
    '## Whole-request rules',
    '',
    ...(policy.requestRules.length > 0 ? ruleTable(policy.requestRules, policy.currency) : ['_None._']),
    '',
  ];
  return lines.join('\n');
}

function ruleTable(rules: readonly PolicyRule[], currency: string): string[] {
  return [
    '| Rule | Applies when | Outcome | What the customer is told |',
    '| --- | --- | --- | --- |',
    ...rules.map(
      (rule) =>
        `| \`${rule.id}\` | ${escapeCell(describeCondition(rule.when, currency))} | ${OUTCOME_LABELS[rule.outcome]} | ${escapeCell(rule.publicReason)} |`,
    ),
  ];
}

function escapeCell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}
