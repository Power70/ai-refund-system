import { z } from 'zod';

const blankAsUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankAsUndefined, schema.optional());

/** Runtime configuration. docker-compose supplies every value, so no .env file is required. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// or postgresql:// connection string'),
  // Mounted read-only at /app/policy in Docker; the default suits running from backend/.
  POLICY_FILE: z.string().min(1).default('../policy/refund-policy.yaml'),
  // Stuck-request sweep interval in ms; 0 disables the sweeper.
  SWEEPER_INTERVAL_MS: z.coerce.number().int().min(0).default(30_000),
  // Minimum AI confidence for an automatic approval. Can only add escalations.
  AI_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.95),
  // Admin API bearer token. Falls back to the documented demo token with a startup warning.
  ADMIN_TOKEN: z.preprocess(blankAsUndefined, z.string().min(12, 'must be at least 12 characters').default('admin-demo-token')),
  // Session cookie signing key. When unset a random key is generated per process (sessions reset on restart).
  SESSION_SECRET: optional(z.string().min(32, 'must be at least 32 characters')),
  // AI provider. Only the key is required; the provider is detected from its prefix.
  // Without a key, AI is disabled and would-be approvals are routed to a reviewer.
  LLM_API_KEY: optional(z.string()),
  LLM_PROVIDER: optional(z.enum(['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'openai-compatible'])),
  LLM_BASE_URL: optional(z.url({ protocol: /^https?$/ })),
  LLM_MODEL: optional(z.string().min(1)),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates process environment at startup. Fails fast with a readable message
 * instead of letting a misconfiguration surface later as a runtime error.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}
