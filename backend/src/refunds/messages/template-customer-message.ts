import type { RequestEvaluation } from '../../policy/policy-evaluation.types.js';

/**
 * Plain, policy-worded message used when no AI reply is available (and for seeded history).
 * Uses only the policy's own customer-facing reasons, so it can never state anything
 * the rules didn't decide.
 */
export function templateCustomerMessage(evaluation: RequestEvaluation, reviewEtaBusinessDays: number): string {
  const reasons = [...new Set(evaluation.lines.map((l) => l.publicReason))];
  switch (evaluation.status) {
    case 'APPROVED':
      return `Your refund has been approved. ${reasons.join(' ')}`.trim();
    case 'DENIED':
      return `We're sorry, this request isn't eligible for a refund. ${reasons.join(' ')}`.trim();
    case 'ESCALATED':
      return `Your request needs a review by our support team. We'll get back to you within ${reviewEtaBusinessDays} business days.`;
  }
}
