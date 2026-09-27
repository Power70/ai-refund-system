/** No registered policy is in force at the requested time. */
export class NoActivePolicyError extends Error {
  constructor(at: Date) {
    super(`No refund policy is in force at ${at.toISOString()}`);
    this.name = 'NoActivePolicyError';
  }
}
