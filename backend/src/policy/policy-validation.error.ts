/** Thrown when a policy file is malformed. Carries every problem found, not just the first. */
export class PolicyValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid refund policy:\n- ${problems.join('\n- ')}`);
    this.name = 'PolicyValidationError';
  }
}
