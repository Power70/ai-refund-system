import { migrateEnvSchema, seedEnvSchema, validateEnv, validateWith } from './env.js';

const DATABASE_URL = 'postgresql://refund:secret@db:5432/refund_support';
const ADMIN_PASSWORD = 'Tq7-long-enough-pass';
const BASE = { DATABASE_URL, ADMIN_PASSWORD };

describe('validateEnv', () => {
  it('applies safe defaults for everything except the database and the admin password', () => {
    expect(validateEnv(BASE)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
      POLICY_FILE: '../policy/refund-policy.yaml',
      AI_MIN_CONFIDENCE: 0.95,
      SWEEPER_INTERVAL_MS: 30_000,
      SUBMIT_WAIT_MS: 3_000,
      ADMIN_PASSWORD,
      AI_TIMEOUT_MS: 20_000,
    });
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ ...BASE, PORT: '8081' }).PORT).toBe(8081);
  });

  it('rejects an out-of-range PORT with a readable message', () => {
    expect(() => validateEnv({ ...BASE, PORT: '70000' })).toThrow(/Invalid environment configuration: PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('requires DATABASE_URL', () => {
    expect(() => validateEnv({ ADMIN_PASSWORD })).toThrow(/DATABASE_URL/);
  });

  it('requires an admin password, but allows the demo defaults', () => {
    expect(() => validateEnv({ DATABASE_URL })).toThrow(/ADMIN_PASSWORD: is required/);
    expect(() => validateEnv({ DATABASE_URL, ADMIN_PASSWORD: '' })).toThrow(/ADMIN_PASSWORD: is required/);
    expect(validateEnv({ DATABASE_URL, ADMIN_PASSWORD: 'admin' }).ADMIN_PASSWORD).toBe('admin');
    expect(validateEnv({ DATABASE_URL, ADMIN_PASSWORD: 'customer' }).ADMIN_PASSWORD).toBe('customer');
  });

  it('accepts non-empty database passwords in production', () => {
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'production' })).not.toThrow();
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'production', DATABASE_URL: 'postgresql://refund:admin@db/x' })).not.toThrow();
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'production', DATABASE_URL: 'postgresql://refund:customer@db/x' })).not.toThrow();
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://x@y/z' })).toThrow(/postgres/);
  });

  it('treats blank AI settings as unset, as docker-compose passes them', () => {
    const env = validateEnv({ ...BASE, LLM_API_KEY: '', LLM_PROVIDER: '', LLM_BASE_URL: ' ', LLM_MODEL: '' });
    expect(env.LLM_API_KEY).toBeUndefined();
    expect(env.LLM_PROVIDER).toBeUndefined();
    expect(env.LLM_BASE_URL).toBeUndefined();
  });

  it('accepts an Anthropic workspace ID and rejects anything else there', () => {
    expect(validateEnv({ ...BASE, ANTHROPIC_WORKSPACE_ID: 'wrkspc_01AbC' }).ANTHROPIC_WORKSPACE_ID).toBe('wrkspc_01AbC');
    expect(validateEnv({ ...BASE, ANTHROPIC_WORKSPACE_ID: '' }).ANTHROPIC_WORKSPACE_ID).toBeUndefined();
    expect(() => validateEnv({ ...BASE, ANTHROPIC_WORKSPACE_ID: 'default' })).toThrow(/ANTHROPIC_WORKSPACE_ID/);
  });

  it('rejects an unknown LLM_PROVIDER and a non-HTTP LLM_BASE_URL', () => {
    expect(() => validateEnv({ ...BASE, LLM_PROVIDER: 'cohere' })).toThrow(/LLM_PROVIDER/);
    expect(() => validateEnv({ ...BASE, LLM_BASE_URL: 'file:///etc/passwd' })).toThrow(/LLM_BASE_URL/);
  });
});

describe('seed configuration', () => {
  const seed = { DATABASE_URL, SEED_CUSTOMER_EMAIL: 'someone@example.org', SEED_CUSTOMER_PASSWORD: 'Another-long-pass9' };

  it('requires the customer email and password from the environment', () => {
    expect(validateWith(seedEnvSchema, seed)).toMatchObject({ SEED_CUSTOMER_EMAIL: 'someone@example.org' });
    expect(() => validateWith(seedEnvSchema, { DATABASE_URL })).toThrow(/SEED_CUSTOMER_EMAIL.*SEED_CUSTOMER_PASSWORD/);
  });

  it('refuses an address that already has a +alias, but accepts the demo customer password', () => {
    expect(() => validateWith(seedEnvSchema, { ...seed, SEED_CUSTOMER_EMAIL: 'someone+1@example.org' })).toThrow(/must not contain/);
    expect(validateWith(seedEnvSchema, { ...seed, SEED_CUSTOMER_PASSWORD: 'customer' }).SEED_CUSTOMER_PASSWORD).toBe('customer');
  });
});

describe('migration configuration', () => {
  it('needs only the database URL, not the API secrets', () => {
    expect(validateWith(migrateEnvSchema, { DATABASE_URL })).toEqual({ DATABASE_URL });
    expect(() => validateWith(migrateEnvSchema, {})).toThrow(/DATABASE_URL/);
  });
});
