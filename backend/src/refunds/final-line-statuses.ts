import type { RequestEvaluation } from '../policy/policy-evaluation.types.js';

export type FinalLineStatus = 'REFUNDED' | 'NOT_REFUNDED' | 'UNDER_REVIEW';

/**
 * What each line becomes once the automated decision is stored:
 *  APPROVED  → ALLOW lines refunded, DENY lines not refunded;
 *  DENIED    → nothing refunded;
 *  ESCALATED → every line waits for a person (and stays reserved).
 */
export function finalLineStatuses(evaluation: RequestEvaluation): Map<string, FinalLineStatus> {
  return new Map(
    evaluation.lines.map((line) => {
      if (evaluation.status === 'ESCALATED') return [line.lineId, 'UNDER_REVIEW'] as const;
      if (evaluation.status === 'APPROVED' && line.outcome === 'ALLOW') return [line.lineId, 'REFUNDED'] as const;
      return [line.lineId, 'NOT_REFUNDED'] as const;
    }),
  );
}
