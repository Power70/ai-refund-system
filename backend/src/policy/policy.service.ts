import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { desc, eq, lte, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalJson } from '../common/canonical-json.js';
import { DATABASE, type Database } from '../database/database.providers.js';
import { policyVersions } from '../database/schema.js';
import { parsePolicy, policyDocumentSchema, type PolicyDocument } from './policy-schema.js';

/** Injection token for the policy YAML path. */
export const POLICY_FILE_PATH = Symbol('POLICY_FILE_PATH');

export class NoActivePolicyError extends Error {
  constructor(at: Date) {
    super(`No refund policy is in force at ${at.toISOString()}`);
    this.name = 'NoActivePolicyError';
  }
}

/** Policy file conflicts with registered versions; fatal at startup. */
export class PolicyRegistrationError extends Error {
  constructor(message: string) {
    super(`Refund policy not registered: ${message}`);
    this.name = 'PolicyRegistrationError';
  }
}

export interface RegisteredPolicy {
  id: string;
  version: string;
  contentHash: string;
  effectiveFrom: Date;
  document: PolicyDocument;
}

export interface RegistrationResult {
  policy: RegisteredPolicy;
  created: boolean;
}

type PolicyVersionRow = typeof policyVersions.$inferSelect;

/** Excludes the version label; independent of YAML comments, formatting and key order. */
export function hashPolicy(policy: PolicyDocument): string {
  const { version: _label, ...rules } = policy;
  return createHash('sha256').update(canonicalJson(rules)).digest('hex');
}

/** Rejects rows whose content no longer matches their hash. */
export function toRegisteredPolicy(row: PolicyVersionRow): RegisteredPolicy {
  const parsed = policyDocumentSchema.safeParse(row.content);
  if (!parsed.success || hashPolicy(parsed.data) !== row.contentHash) {
    throw new Error(`Stored refund policy "${row.version}" failed its integrity check and cannot be used`);
  }
  return { id: row.id, version: row.version, contentHash: row.contentHash, effectiveFrom: row.effectiveFrom, document: parsed.data };
}

export interface ExistingVersions {
  sameVersion?: PolicyVersionRow;
  sameContent?: PolicyVersionRow;
  latest?: PolicyVersionRow;
}

/**
 * Same file is a no-op; a label can't name different rules; identical rules can't get a second
 * label; effectiveFrom must be after the latest version. Returns a row to reuse, or null to insert.
 */
export function checkRegistration(document: PolicyDocument, contentHash: string, existing: ExistingVersions): PolicyVersionRow | null {
  const { sameVersion, sameContent, latest } = existing;
  if (sameVersion) {
    if (sameVersion.contentHash === contentHash) return sameVersion;
    throw new PolicyRegistrationError(`version "${document.version}" is already registered with different rules. Give the changed policy a new version label.`);
  }
  if (sameContent) {
    throw new PolicyRegistrationError(`these exact rules are already registered as version "${sameContent.version}". Use that label, or change the rules.`);
  }
  if (latest && new Date(document.effectiveFrom).getTime() <= latest.effectiveFrom.getTime()) {
    throw new PolicyRegistrationError(
      `effectiveFrom ${document.effectiveFrom} is not after version "${latest.version}" (${latest.effectiveFrom.toISOString()}). A new version must take effect later than every existing one.`,
    );
  }
  return null;
}

// Advisory lock key: serialises registration across concurrently starting instances.
const REGISTRATION_LOCK_KEY = 815_224_001;

@Injectable()
export class PolicyService implements OnModuleInit {
  private readonly logger = new Logger(PolicyService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(POLICY_FILE_PATH) private readonly policyFilePath: string,
  ) {}

  async onModuleInit(): Promise<void> {
    const { policy } = await this.registerPolicyFile();
    const active = await this.activePolicy();
    if (active.id !== policy.id) {
      this.logger.warn(`Policy "${policy.version}" takes effect ${policy.effectiveFrom.toISOString()}; "${active.version}" is in force until then.`);
    }
  }

  async registerPolicyFile(): Promise<RegistrationResult> {
    const result = await this.register(parsePolicy(await readFile(this.policyFilePath, 'utf8')));
    const { policy, created } = result;
    this.logger.log(`Refund policy "${policy.version}" ${created ? 'registered' : 'already registered'} (${policy.contentHash.slice(0, 12)}…)`);
    return result;
  }

  /** Idempotent; see checkRegistration. */
  async register(document: PolicyDocument): Promise<RegistrationResult> {
    const contentHash = hashPolicy(document);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${REGISTRATION_LOCK_KEY})`);
      // Sequential: a transaction's connection runs one query at a time.
      const [sameVersion] = await tx.select().from(policyVersions).where(eq(policyVersions.version, document.version));
      const [sameContent] = await tx.select().from(policyVersions).where(eq(policyVersions.contentHash, contentHash));
      const [latest] = await tx.select().from(policyVersions).orderBy(desc(policyVersions.effectiveFrom)).limit(1);
      const reuse = checkRegistration(document, contentHash, { sameVersion, sameContent, latest });
      if (reuse) return { policy: toRegisteredPolicy(reuse), created: false };

      const [row] = await tx
        .insert(policyVersions)
        .values({ version: document.version, contentHash, content: document, effectiveFrom: new Date(document.effectiveFrom) })
        .returning();
      return { policy: toRegisteredPolicy(row), created: true };
    });
  }

  /** Latest version with effectiveFrom <= `at`. */
  async activePolicy(at: Date = new Date(), db: Database = this.db): Promise<RegisteredPolicy> {
    const [row] = await db.select().from(policyVersions).where(lte(policyVersions.effectiveFrom, at)).orderBy(desc(policyVersions.effectiveFrom)).limit(1);
    if (!row) throw new NoActivePolicyError(at);
    return toRegisteredPolicy(row);
  }

  async policyById(id: string): Promise<RegisteredPolicy> {
    const [row] = await this.db.select().from(policyVersions).where(eq(policyVersions.id, id));
    if (!row) throw new Error(`Policy version ${id} not found`);
    return toRegisteredPolicy(row);
  }
}
