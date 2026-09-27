import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createPgPool } from '../../src/database/create-pg-pool.js';
import { runMigrations } from '../../src/database/run-migrations.js';
import * as schema from '../../src/database/schema/index.js';
import { seedDemoCatalog } from '../../src/database/seed/seed-demo-catalog.js';
import { seedDemoHistory } from '../../src/database/seed/seed-demo-history.js';
import { parsePolicy } from '../../src/policy/parse-policy.js';
import { findActivePolicy } from '../../src/policy/registry/find-active-policy.js';
import { registerPolicyVersion } from '../../src/policy/registry/register-policy-version.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

/** A fresh database with exactly what `docker-compose up` produces: migrations, catalog, policy, history. */
export async function prepareDemoDatabase(): Promise<TestDatabase> {
  const testDb = await createTestDatabase();
  await runMigrations(testDb.url);
  const pool = createPgPool(testDb.url);
  try {
    const db = drizzle(pool, { schema });
    const now = new Date();
    await seedDemoCatalog(db, now);
    await registerPolicyVersion(db, parsePolicy(readFileSync(new URL('../../../policy/refund-policy.yaml', import.meta.url), 'utf8')));
    await seedDemoHistory(db, await findActivePolicy(db, now), now);
  } finally {
    await pool.end();
  }
  return testDb;
}
