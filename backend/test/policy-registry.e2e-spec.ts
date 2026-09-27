import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { createPgPool } from '../src/database/create-pg-pool.js';
import type { Database } from '../src/database/database.types.js';
import { runMigrations } from '../src/database/run-migrations.js';
import * as schema from '../src/database/schema/index.js';
import { findActivePolicy } from '../src/policy/registry/find-active-policy.js';
import { NoActivePolicyError } from '../src/policy/registry/no-active-policy.error.js';
import { registerPolicyVersion } from '../src/policy/registry/register-policy-version.js';
import { policyDocument } from './support/policy-document.fixture.js';
import { createTestDatabase, type TestDatabase } from './support/test-database.js';

describe('policy registry (e2e, real PostgreSQL)', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: Database;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    await runMigrations(testDb.url);
    pool = createPgPool(testDb.url);
    db = drizzle(pool, { schema });
  });

  afterEach(async () => {
    await pool?.end();
    await testDb?.drop();
  });

  const versionCount = async () => (await db.select({ n: count() }).from(schema.policyVersions))[0].n;

  it('registers a new version once; re-registering the same file is a no-op', async () => {
    const doc = policyDocument('v1', '2026-01-01T00:00:00Z');
    const first = await registerPolicyVersion(db, doc);
    const again = await registerPolicyVersion(db, structuredClone(doc));
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, policy: { id: first.policy.id } });
    expect(await versionCount()).toBe(1);
  });

  it('refuses changed rules under an existing version label', async () => {
    await registerPolicyVersion(db, policyDocument('v1', '2026-01-01T00:00:00Z', 30));
    await expect(registerPolicyVersion(db, policyDocument('v1', '2026-01-01T00:00:00Z', 14))).rejects.toThrow(
      /version "v1" is already registered with different rules/,
    );
  });

  it('refuses identical rules under a second label', async () => {
    const doc = policyDocument('v1', '2026-01-01T00:00:00Z');
    await registerPolicyVersion(db, doc);
    await expect(registerPolicyVersion(db, { ...doc, version: 'v1-copy' })).rejects.toThrow(
      /these exact rules are already registered as version "v1"/,
    );
  });

  it('allows going back to earlier rules under a new label with a new effective date', async () => {
    await registerPolicyVersion(db, policyDocument('v1', '2026-01-01T00:00:00Z', 30));
    await registerPolicyVersion(db, policyDocument('v2', '2026-03-01T00:00:00Z', 14));
    await expect(registerPolicyVersion(db, policyDocument('v3', '2026-05-01T00:00:00Z', 30))).resolves.toMatchObject({ created: true });
  });

  it('refuses a new version that takes effect before or at the latest one (no rewriting history)', async () => {
    await registerPolicyVersion(db, policyDocument('v2', '2026-06-01T00:00:00Z'));
    await expect(registerPolicyVersion(db, policyDocument('v1', '2026-01-01T00:00:00Z'))).rejects.toThrow(/must take effect later/);
    await expect(registerPolicyVersion(db, policyDocument('v3', '2026-06-01T00:00:00Z', 20))).rejects.toThrow(/must take effect later/);
  });

  it('answers "which policy was in force at time T" by effective date', async () => {
    await registerPolicyVersion(db, policyDocument('v1', '2026-01-01T00:00:00Z', 30));
    await registerPolicyVersion(db, policyDocument('v2', '2026-06-01T00:00:00Z', 14));

    await expect(findActivePolicy(db, new Date('2025-12-31T23:59:59Z'))).rejects.toThrow(NoActivePolicyError);
    expect((await findActivePolicy(db, new Date('2026-03-01T00:00:00Z'))).version).toBe('v1');
    expect((await findActivePolicy(db, new Date('2026-06-01T00:00:00Z'))).version).toBe('v2');
    const active = await findActivePolicy(db, new Date('2026-09-27T00:00:00Z'));
    expect(active.document.lineRules[0].when).toEqual({ fact: 'item.daysSinceDelivery', op: 'gt', value: 14 });
  });

  it('keeps a scheduled future version inactive until its date', async () => {
    await registerPolicyVersion(db, policyDocument('now', '2026-01-01T00:00:00Z'));
    await registerPolicyVersion(db, policyDocument('later', '2999-01-01T00:00:00Z', 7));
    expect((await findActivePolicy(db, new Date('2026-09-27T00:00:00Z'))).version).toBe('now');
  });

  it('rejects a stored policy that was edited in the database', async () => {
    const { policy } = await registerPolicyVersion(db, policyDocument('v1', '2026-01-01T00:00:00Z', 30));
    const tampered = { ...policy.document, lineRules: [{ ...policy.document.lineRules[0], outcome: 'ALLOW' }] };
    await db.update(schema.policyVersions).set({ content: tampered as never }).where(eq(schema.policyVersions.id, policy.id));
    await expect(findActivePolicy(db, new Date('2026-09-27T00:00:00Z'))).rejects.toThrow(/integrity check/);
  });

  it('registers exactly once when several instances start at the same time', async () => {
    const doc = policyDocument('v1', '2026-01-01T00:00:00Z');
    const results = await Promise.all(Array.from({ length: 5 }, () => registerPolicyVersion(db, structuredClone(doc))));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.policy.id)).size).toBe(1);
    expect(await versionCount()).toBe(1);
  });
});
