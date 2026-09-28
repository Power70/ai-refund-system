import { validateEnv } from './env.js';

const DATABASE_URL = 'postgresql://refund:secret@db:5432/refund_support';

describe('validateEnv', () => {
  it('applies safe defaults for everything except the database', () => {
    expect(validateEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
      POLICY_FILE: '../policy/refund-policy.yaml',
      AI_MIN_CONFIDENCE: 0.95,
      SWEEPER_INTERVAL_MS: 30_000,
      ADMIN_TOKEN: 'admin-demo-token',
      AI_TIMEOUT_MS: 20_000,
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

  it('treats blank AI settings as unset, as docker-compose passes them', () => {
    const env = validateEnv({ DATABASE_URL, LLM_API_KEY: '', LLM_PROVIDER: '', LLM_BASE_URL: ' ', LLM_MODEL: '' });
    expect(env.LLM_API_KEY).toBeUndefined();
    expect(env.LLM_PROVIDER).toBeUndefined();
    expect(env.LLM_BASE_URL).toBeUndefined();
  });

  it('accepts an Anthropic workspace ID and rejects anything else there', () => {
    expect(validateEnv({ DATABASE_URL, ANTHROPIC_WORKSPACE_ID: 'wrkspc_01AbC' }).ANTHROPIC_WORKSPACE_ID).toBe('wrkspc_01AbC');
    expect(validateEnv({ DATABASE_URL, ANTHROPIC_WORKSPACE_ID: '' }).ANTHROPIC_WORKSPACE_ID).toBeUndefined();
    expect(() => validateEnv({ DATABASE_URL, ANTHROPIC_WORKSPACE_ID: 'default' })).toThrow(/ANTHROPIC_WORKSPACE_ID/);
  });

  it('rejects an unknown LLM_PROVIDER and a non-HTTP LLM_BASE_URL', () => {
    expect(() => validateEnv({ DATABASE_URL, LLM_PROVIDER: 'cohere' })).toThrow(/LLM_PROVIDER/);
    expect(() => validateEnv({ DATABASE_URL, LLM_BASE_URL: 'file:///etc/passwd' })).toThrow(/LLM_BASE_URL/);
  });
});
