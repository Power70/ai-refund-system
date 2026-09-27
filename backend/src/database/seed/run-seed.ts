/**
 * Loads the demo CRM data. Runs in the one-shot "migrate" service right after migrations:
 *   node dist/database/seed/run-seed.js
 */
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { validateEnv } from '../../config/validate-env.js';
import { createPgPool } from '../create-pg-pool.js';
import * as schema from '../schema/index.js';
import { seedDemoCatalog } from './seed-demo-catalog.js';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { DATABASE_URL } = validateEnv(process.env);
  const pool = createPgPool(DATABASE_URL);
  try {
    const summary = await seedDemoCatalog(drizzle(pool, { schema }), new Date());
    console.log(`Demo data ready: ${summary.customers} customers, ${summary.orders} orders, ${summary.items} items.`);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
