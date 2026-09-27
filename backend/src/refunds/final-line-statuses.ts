import type { PolicyStatus, RequestEvaluation } from '../policy/policy-evaluation.types.js';

export type FinalLineStatus = 'REFUNDED' | 'NOT_REFUNDED' | 'UNDER_REVIEW';

/**
 * What each line becomes once the final decision is stored:
 *  APPROVED  → ALLOW lines refunded, DENY lines not refunded;
 *  DENIED    → nothing refunded;
 *  ESCALATED → every line waits for a person (and stays reserved).
 * `finalStatus` is the status after the safety gate, which may hold back a policy approval.
 */
export function finalLineStatuses(
  evaluation: RequestEvaluation,
  finalStatus: PolicyStatus = evaluation.status,
): Map<string, FinalLineStatus> {
  return new Map(
    evaluation.lines.map((line) => {
      if (finalStatus === 'ESCALATED') return [line.lineId, 'UNDER_REVIEW'] as const;
      if (finalStatus === 'APPROVED' && line.outcome === 'ALLOW') return [line.lineId, 'REFUNDED'] as const;
      return [line.lineId, 'NOT_REFUNDED'] as const;
    }),
  );
}
