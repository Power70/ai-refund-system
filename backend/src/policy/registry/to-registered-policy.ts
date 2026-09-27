import type { policyVersions } from '../../database/schema/index.js';
import { policyDocumentSchema } from '../policy.schema.js';
import type { RegisteredPolicy } from './active-policy.types.js';
import { hashPolicy } from './hash-policy.js';

type PolicyVersionRow = typeof policyVersions.$inferSelect;

/**
 * Maps a stored row back to a policy, re-validating it on the way out: a row edited by
 * hand in the database is rejected instead of being used to decide refunds.
 */
export function toRegisteredPolicy(row: PolicyVersionRow): RegisteredPolicy {
  const parsed = policyDocumentSchema.safeParse(row.content);
  if (!parsed.success || hashPolicy(parsed.data) !== row.contentHash) {
    throw new Error(`Stored refund policy "${row.version}" failed its integrity check and cannot be used`);
  }
  return {
    id: row.id,
    version: row.version,
    contentHash: row.contentHash,
    effectiveFrom: row.effectiveFrom,
    document: parsed.data,
  };
}
