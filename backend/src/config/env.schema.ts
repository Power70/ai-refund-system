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
});

export type Env = z.infer<typeof envSchema>;
