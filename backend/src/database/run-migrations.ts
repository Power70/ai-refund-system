/**
 * Applies pending SQL migrations from backend/drizzle, then exits.
 * Runs as the one-shot "migrate" service before the API starts:
 *   node dist/database/run-migrations.js
 * Uses the runtime drizzle-orm migrator only, so no CLI tools are needed in the image.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { validateEnv } from '../config/env.js';
import { createPgPool } from './database.providers.js';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = createPgPool(connectionString);
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { DATABASE_URL } = validateEnv(process.env);
  try {
    await runMigrations(DATABASE_URL);
    console.log('Migrations applied.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}
