import { z } from 'zod';

const blankAsUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankAsUndefined, schema.optional());

// Values that must never guard a real system: placeholders and the most common passwords.
const WEAK = /^(change[-_ ]?me.*|.*placeholder.*|password\d*|admin\d*|customer\d*|secret\d*|12345678.*|qwerty.*|letmein.*)$/i;

/** A required secret: no default, at least `min` characters, not a placeholder or a well-known password. */
export const secret = (min: number) =>
  z.preprocess(
    blankAsUndefined,
    z
      .string({ error: 'is required (set it in .env)' })
      .min(min, `must be at least ${min} characters`)
      .max(200)
      .refine((v) => !WEAK.test(v), 'is a placeholder or a well-known password; choose your own')
      .refine((v) => new Set(v).size >= 6, 'is too simple (use at least 6 different characters)'),
  );

/** Runtime configuration. docker-compose supplies every value, so no .env file is required. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// or postgresql:// connection string'),
  // Mounted read-only at /app/policy in Docker; the default suits running from backend/.
  POLICY_FILE: z.string().min(1).default('../policy/refund-policy.yaml'),
  // Stuck-request sweep interval in ms; 0 disables the sweeper.
  SWEEPER_INTERVAL_MS: z.coerce.number().int().min(0).default(30_000),
  // How long a submission waits for its decision before answering 202 (still processing).
  SUBMIT_WAIT_MS: z.coerce.number().int().min(0).max(30_000).default(3_000),
  // Minimum AI confidence for an automatic approval. Can only add escalations.
  AI_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.95),
  // Support dashboard password. Required: there is no default, and weak values are refused.
  ADMIN_PASSWORD: secret(12),
  // Serve the OpenAPI docs at /api/docs. Off by default in production.
  API_DOCS: optional(z.enum(['true', 'false']).transform((v) => v === 'true')),
  // AI provider. Only the key is required; the provider is detected from its prefix.
  // Without a key, AI is disabled and would-be approvals are routed to a reviewer.
  LLM_API_KEY: optional(z.string()),
  LLM_PROVIDER: optional(z.enum(['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'openai-compatible'])),
  LLM_BASE_URL: optional(z.url({ protocol: /^https?$/ })),
  LLM_MODEL: optional(z.string().min(1)),
  // Anthropic organization-level keys (not scoped to a workspace) must name a workspace, e.g. wrkspc_01….
  ANTHROPIC_WORKSPACE_ID: optional(z.string().regex(/^wrkspc_\w+$/, 'must look like wrkspc_…')),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
});

export type Env = z.infer<typeof envSchema>;

/** In production the database password (inside DATABASE_URL) must be a real secret too. */
function checkDatabasePassword(env: { NODE_ENV?: string; DATABASE_URL: string }, ctx: z.RefinementCtx): void {
  if (env.NODE_ENV !== 'production') return;
  const password = URL.canParse(env.DATABASE_URL) ? decodeURIComponent(new URL(env.DATABASE_URL).password) : '';
  const problem = secret(12).safeParse(password).error?.issues[0]?.message;
  if (problem) ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: `password ${problem} (set POSTGRES_PASSWORD in .env)` });
}

/**
 * Validates process environment at startup. Fails fast with a readable message
 * instead of letting a misconfiguration surface later as a runtime error.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  return validateWith(envSchema.superRefine(checkDatabasePassword), raw);
}

/** What the one-shot seed needs on top of the database: the demo customers' sign-in details. */
export const seedEnvSchema = z
  .object({
    NODE_ENV: envSchema.shape.NODE_ENV,
    DATABASE_URL: envSchema.shape.DATABASE_URL,
    POLICY_FILE: envSchema.shape.POLICY_FILE,
    // Customer N signs in as <local>+N@<domain> of this address.
    SEED_CUSTOMER_EMAIL: z.preprocess(blankAsUndefined, z.email({ error: 'must be an email address (set it in .env)' }).refine((v) => !v.split('@')[0].includes('+'), 'must not contain "+" (the seed adds +1 … +15)')),
    SEED_CUSTOMER_PASSWORD: secret(12),
  })
  .superRefine(checkDatabasePassword);

export type SeedEnv = z.infer<typeof seedEnvSchema>;

/** Validates with `schema` and throws one readable message listing every problem. */
export function validateWith<T extends z.ZodType>(schema: T, raw: Record<string, unknown>): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}
