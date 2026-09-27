import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { PolicyDocument } from '../../policy/policy.schema.js';

/**
 * Every refund policy that has ever been loaded. Decisions reference the version
 * they were made under, so changing the policy never rewrites history.
 */
export const policyVersions = pgTable('policy_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  // One label per rule set: re-using a label with different content is rejected at startup.
  version: text('version').notNull().unique(),
  // SHA-256 of the parsed policy, so identical content is recognised across restarts.
  contentHash: text('content_hash').notNull().unique(),
  content: jsonb('content').$type<PolicyDocument>().notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
