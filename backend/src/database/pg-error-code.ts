/**
 * Extracts the PostgreSQL SQLSTATE code (e.g. "23505" unique violation) from an error,
 * whether it came straight from node-postgres or wrapped by Drizzle.
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
