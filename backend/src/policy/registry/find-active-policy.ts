import { desc, lte } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';
import { policyVersions } from '../../database/schema/index.js';
import type { RegisteredPolicy } from './active-policy.types.js';
import { NoActivePolicyError } from './no-active-policy.error.js';
import { toRegisteredPolicy } from './to-registered-policy.js';

/** The policy in force at `at`: the latest version whose effectiveFrom is not in the future. */
export async function findActivePolicy(db: Database, at: Date): Promise<RegisteredPolicy> {
  const [row] = await db
    .select()
    .from(policyVersions)
    .where(lte(policyVersions.effectiveFrom, at))
    .orderBy(desc(policyVersions.effectiveFrom))
    .limit(1);
  if (!row) throw new NoActivePolicyError(at);
  return toRegisteredPolicy(row);
}
