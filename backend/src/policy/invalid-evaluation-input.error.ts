/** The caller passed malformed input to the policy engine: a programming error, never a customer's fault. */
export class InvalidEvaluationInputError extends Error {
  constructor(message: string) {
    super(`Invalid policy evaluation input: ${message}`);
    this.name = 'InvalidEvaluationInputError';
  }
}
