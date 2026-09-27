import { eq } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';
import { policyVersions } from '../../database/schema/index.js';
import type { RegisteredPolicy } from './active-policy.types.js';
import { toRegisteredPolicy } from './to-registered-policy.js';

/** A specific registered version (e.g. the one captured when a request was submitted). */
export async function findPolicyById(db: Database, id: string): Promise<RegisteredPolicy> {
  const [row] = await db.select().from(policyVersions).where(eq(policyVersions.id, id));
  if (!row) throw new Error(`Policy version ${id} not found`);
  return toRegisteredPolicy(row);
}
