import { z } from 'zod';

/**
 * Single source of truth for runtime configuration.
 * docker-compose supplies every value, so `docker-compose up` works without a .env file.
 * Later bits extend this schema (database, AI provider, secrets).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // docker-compose always supplies this; there is no safe default for a database.
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// or postgresql:// connection string'),
  // The company refund policy. Docker mounts ./policy read-only at /app/policy;
  // the default suits running from backend/ in development.
  POLICY_FILE: z.string().min(1).default('../policy/refund-policy.yaml'),
  // Signs customer session cookies. Optional: when unset (or empty) a random secret is generated
  // at startup, so no guessable default ever ships in the public repo; sessions then reset on restart.
  // How often stuck requests are swept, in ms (0 = off).
  SWEEPER_INTERVAL_MS: z.coerce.number().int().min(0).default(30_000),
  // An automatic approval also needs the AI's self-reported confidence at or above this.
  // It can only add escalations; it is never the sole check (see the safety gate).
  AI_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.95),
  SESSION_SECRET: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(32, 'must be at least 32 characters').optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;
