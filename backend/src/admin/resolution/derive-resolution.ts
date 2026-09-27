import type { LineResolution } from '../../database/schema/review-resolutions.table.js';

export type ResolutionOutcome = 'APPROVED' | 'PARTIALLY_APPROVED' | 'DENIED';

export interface ResolvableLine {
  id: string;
  amountMinor: number;
}

export interface DerivedResolution {
  outcome: ResolutionOutcome;
  approvedAmountMinor: number;
  /** One decision per line, in the request's line order. */
  lineDecisions: LineResolution[];
}

/**
 * Turns a reviewer's yes/no per line into the stored resolution. The reviewer never types
 * an amount: the outcome and total come from the approved lines, so money and quantities agree.
 * Returns null unless the decisions cover exactly the request's lines, each once.
 */
export function deriveResolution(lines: readonly ResolvableLine[], decisions: readonly LineResolution[]): DerivedResolution | null {
  const approveById = new Map(decisions.map((d) => [d.lineId, d.approve]));
  if (lines.length === 0 || approveById.size !== decisions.length || approveById.size !== lines.length) return null;
  if (lines.some((line) => !approveById.has(line.id))) return null;

  const lineDecisions = lines.map((line) => ({ lineId: line.id, approve: approveById.get(line.id)! }));
  const approved = lines.filter((line) => approveById.get(line.id));
  const outcome: ResolutionOutcome = approved.length === 0 ? 'DENIED' : approved.length === lines.length ? 'APPROVED' : 'PARTIALLY_APPROVED';
  return { outcome, approvedAmountMinor: approved.reduce((sum, line) => sum + line.amountMinor, 0), lineDecisions };
}
