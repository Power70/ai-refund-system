import { validateEnv } from './validate-env.js';

describe('validateEnv', () => {
  it('applies safe defaults when nothing is set', () => {
    expect(validateEnv({})).toEqual({ NODE_ENV: 'development', PORT: 3000 });
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ PORT: '8081' }).PORT).toBe(8081);
  });

  it('rejects an out-of-range PORT with a readable message', () => {
    expect(() => validateEnv({ PORT: '70000' })).toThrow(/Invalid environment configuration: PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
