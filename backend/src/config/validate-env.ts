import { envSchema, type Env } from './env.schema.js';

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
