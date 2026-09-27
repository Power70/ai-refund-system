/** A rule referenced a fact the fact builder didn't supply: a programming error, never a customer's fault. */
export class MissingFactError extends Error {
  constructor(readonly fact: string) {
    super(`Fact "${fact}" was not provided to the policy evaluator`);
    this.name = 'MissingFactError';
  }
}
