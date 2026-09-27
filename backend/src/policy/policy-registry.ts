import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { desc, lte, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DATABASE, type Database } from '../database/database.js';
import { policyVersions } from '../database/schema.js';
import { policyDocumentSchema, parsePolicy, type PolicyDocument } from './policy-schema.js';

/** Injection token for the path of the policy YAML file (overridable in tests). */
export const POLICY_FILE_PATH = Symbol('POLICY_FILE_PATH');

/** No registered policy is in force at the requested time. */
export class NoActivePolicyError extends Error {
  constructor(at: Date) {
    super(`No refund policy is in force at ${at.toISOString()}`);
    this.name = 'NoActivePolicyError';
  }
}

/** A policy file conflicts with what is already registered. Stops startup with a clear fix. */
export class PolicyRegistrationError extends Error {
  constructor(message: string) {
    super(`Refund policy not registered: ${message}`);
    this.name = 'PolicyRegistrationError';
  }
}

/** A registered policy version: what decisions reference and evaluate against. */
export interface RegisteredPolicy {
  id: string;
  version: string;
  contentHash: string;
  effectiveFrom: Date;
  document: PolicyDocument;
}

/**
 * JSON with object keys sorted at every level, so logically equal values always
 * serialise identically (key order in the YAML file doesn't matter).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * Fingerprint of the rules themselves. The version label is excluded (it names the rules,
 * it isn't one of them), and comments, formatting and key order don't change it.
 */
export function hashPolicy(policy: PolicyDocument): string {
  const { version: _label, ...rules } = policy;
  return createHash('sha256').update(canonicalJson(rules)).digest('hex');
}

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

/** A specific registered version (e.g. the one captured when a request was submitted). */
export async function findPolicyById(db: Database, id: string): Promise<RegisteredPolicy> {
  const [row] = await db.select().from(policyVersions).where(eq(policyVersions.id, id));
  if (!row) throw new Error(`Policy version ${id} not found`);
  return toRegisteredPolicy(row);
}

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

@Injectable()
export class PolicyRegistryService implements OnModuleInit {
  private readonly logger = new Logger(PolicyRegistryService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(POLICY_FILE_PATH) private readonly policyFilePath: string,
  ) {}

  /**
   * Startup: validate the policy file, register its version, and make sure some policy
   * is in force right now. Any problem stops the API from starting, with the reason.
   */
  async onModuleInit(): Promise<void> {
    const document = parsePolicy(await readFile(this.policyFilePath, 'utf8'));
    const { policy, created } = await registerPolicyVersion(this.db, document);
    this.logger.log(`Refund policy "${policy.version}" ${created ? 'registered' : 'already registered'} (${policy.contentHash.slice(0, 12)}…)`);

    const active = await this.getActivePolicy(new Date());
    if (active.id !== policy.id) {
      this.logger.warn(`Policy "${policy.version}" takes effect ${policy.effectiveFrom.toISOString()}; "${active.version}" is in force until then.`);
    }
  }

  /** The policy that decides a request submitted at `at` (defaults to now). */
  getActivePolicy(at: Date = new Date()): Promise<RegisteredPolicy> {
    return findActivePolicy(this.db, at);
  }
}
