import { desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';
import { policyVersions } from '../../database/schema/index.js';
import type { PolicyDocument } from '../policy.schema.js';
import type { RegisteredPolicy } from './active-policy.types.js';
import { hashPolicy } from './hash-policy.js';
import { PolicyRegistrationError } from './policy-registration.error.js';
import { toRegisteredPolicy } from './to-registered-policy.js';

// Arbitrary constant: serialises registration across API instances starting at the same time.
const REGISTRATION_LOCK_KEY = 815_224_001;

export interface RegistrationResult {
  policy: RegisteredPolicy;
  created: boolean;
}

/**
 * Records a policy version, once. Re-registering the same file is a no-op. It refuses to:
 *  - reuse a version label for different rules (the label would no longer identify one rule set);
 *  - register identical rules under a second label;
 *  - backdate: a new version must take effect after every existing one, so the answer to
 *    "which policy was in force at time T?" can never change after the fact.
 */
export async function registerPolicyVersion(db: Database, document: PolicyDocument): Promise<RegistrationResult> {
  const contentHash = hashPolicy(document);
  const effectiveFrom = new Date(document.effectiveFrom);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${REGISTRATION_LOCK_KEY})`);

    const [sameVersion] = await tx.select().from(policyVersions).where(eq(policyVersions.version, document.version));
    if (sameVersion) {
      if (sameVersion.contentHash === contentHash) return { policy: toRegisteredPolicy(sameVersion), created: false };
      throw new PolicyRegistrationError(
        `version "${document.version}" is already registered with different rules. Give the changed policy a new version label.`,
      );
    }

    const [sameContent] = await tx.select().from(policyVersions).where(eq(policyVersions.contentHash, contentHash));
    if (sameContent) {
      throw new PolicyRegistrationError(
        `these exact rules are already registered as version "${sameContent.version}". Use that label, or change the rules.`,
      );
    }

    const [latest] = await tx.select().from(policyVersions).orderBy(desc(policyVersions.effectiveFrom)).limit(1);
    if (latest && effectiveFrom.getTime() <= latest.effectiveFrom.getTime()) {
      throw new PolicyRegistrationError(
        `effectiveFrom ${document.effectiveFrom} is not after version "${latest.version}" (${latest.effectiveFrom.toISOString()}). A new version must take effect later than every existing one.`,
      );
    }

    const [row] = await tx
      .insert(policyVersions)
      .values({ version: document.version, contentHash, content: document, effectiveFrom })
      .returning();
    return { policy: toRegisteredPolicy(row), created: true };
  });
}
