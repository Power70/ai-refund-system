/**
 * Raised inside transaction 1 when, after waiting for the item locks, a request with the
 * same idempotency key turns out to exist (a simultaneous retry won). The caller answers
 * with that request instead of treating this retry as a competing claim.
 */
export class IdempotentReplaySignal extends Error {
  constructor() {
    super('A request with this idempotency key already exists');
    this.name = 'IdempotentReplaySignal';
  }
}
