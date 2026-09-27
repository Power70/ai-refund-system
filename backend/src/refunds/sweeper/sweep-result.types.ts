export interface SweepResult {
  /** Stuck requests found. */
  found: number;
  /** Decided normally on this pass. */
  decided: number;
  /** Handed to a person after too many failed attempts. */
  escalated: number;
  /** Still not finished (will be retried once the new lease expires). */
  retryLater: number;
}
