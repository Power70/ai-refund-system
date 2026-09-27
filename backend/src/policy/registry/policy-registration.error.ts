/** A policy file conflicts with what is already registered. Stops startup with a clear fix. */
export class PolicyRegistrationError extends Error {
  constructor(message: string) {
    super(`Refund policy not registered: ${message}`);
    this.name = 'PolicyRegistrationError';
  }
}
