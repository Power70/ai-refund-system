import { z } from 'zod';

/**
 * Single source of truth for runtime configuration.
 * Every variable has a safe default so `docker-compose up` works without a .env file.
 * Later bits extend this schema (database, AI provider, secrets).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type Env = z.infer<typeof envSchema>;
