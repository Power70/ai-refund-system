import { validateEnv } from './validate-env.js';

const DATABASE_URL = 'postgresql://refund:secret@db:5432/refund_support';

describe('validateEnv', () => {
  it('applies safe defaults for everything except the database', () => {
    expect(validateEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
      POLICY_FILE: '../policy/refund-policy.yaml',
    });
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ DATABASE_URL, PORT: '8081' }).PORT).toBe(8081);
  });

  it('rejects an out-of-range PORT with a readable message', () => {
    expect(() => validateEnv({ DATABASE_URL, PORT: '70000' })).toThrow(/Invalid environment configuration: PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ DATABASE_URL, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('requires DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://x@y/z' })).toThrow(/postgres/);
  });
});
