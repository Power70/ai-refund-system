/**
 * Loads the demo data. Runs in the one-shot "migrate" service right after migrations:
 *   node dist/database/seed/run-seed.js
 * Order matters: catalog → register the refund policy → history decided under that policy.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnv } from '../../config/env.js';
import { findActivePolicy, registerPolicyVersion } from '../../policy/policy-registry.js';
import { parsePolicy } from '../../policy/policy-schema.js';
import { createPgPool } from '../database.js';
import * as schema from '../schema.js';
import { seedDemoCatalog, seedDemoHistory } from './seed.js';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { DATABASE_URL, POLICY_FILE } = validateEnv(process.env);
  const pool = createPgPool(DATABASE_URL);
  const db = drizzle(pool, { schema });
  try {
    const now = new Date();
    const catalog = await seedDemoCatalog(db, now);
    await registerPolicyVersion(db, parsePolicy(await readFile(resolve(POLICY_FILE), 'utf8')));
    const policy = await findActivePolicy(db, now);
    const history = await seedDemoHistory(db, policy, now);
    console.log(
      `Demo data ready: ${catalog.customers} customers, ${catalog.orders} orders, ${catalog.items} items; ` +
        `history ${history.created} created, ${history.refreshed} refreshed (policy ${policy.version}).`,
    );
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
