import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { stringify } from 'yaml';
import { runMigrations } from '../src/database/run-migrations.js';
import * as schema from '../src/database/schema/index.js';
import { PolicyValidationError } from '../src/policy/policy-validation.error.js';
import { NoActivePolicyError } from '../src/policy/registry/no-active-policy.error.js';
import { PolicyRegistrationError } from '../src/policy/registry/policy-registration.error.js';
import { createTestApp } from './create-test-app.js';
import { policyDocument } from './support/policy-document.fixture.js';
import { createTestDatabase, type TestDatabase } from './support/test-database.js';

const tempDir = mkdtempSync(join(tmpdir(), 'policy-'));
function policyFile(name: string, content: string): string {
  const path = join(tempDir, name);
  writeFileSync(path, content);
  return path;
}

describe('API startup and the refund policy (e2e)', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
    await runMigrations(db.url);
  });

  afterEach(async () => {
    await db?.drop();
  });

  it('registers the real policy file on startup, and again is a no-op', async () => {
    const realYaml = readFileSync(new URL('../../policy/refund-policy.yaml', import.meta.url), 'utf8');
    for (let i = 0; i < 2; i++) await (await createTestApp(db.url)).close();
    const pool = new pg.Pool({ connectionString: db.url });
    const rows = await drizzle(pool, { schema }).select().from(schema.policyVersions);
    await pool.end();
    expect(rows.map((r) => r.version)).toEqual([realYaml.match(/^version: "(.+)"$/m)?.[1]]);
  });

  it('refuses to start with an invalid policy file, and says why', async () => {
    const bad = policyFile('bad.yaml', stringify({ ...policyDocument('x', '2026-01-01T00:00:00Z'), defaultOutcome: 'ALLOW' }));
    await expect(createTestApp(db.url, { policyFilePath: bad })).rejects.toThrow(PolicyValidationError);
  });

  it('refuses to start when the rules changed but the version label did not', async () => {
    await (await createTestApp(db.url, { policyFilePath: policyFile('a.yaml', stringify(policyDocument('v1', '2026-01-01T00:00:00Z', 30))) })).close();
    const changed = policyFile('b.yaml', stringify(policyDocument('v1', '2026-01-01T00:00:00Z', 14)));
    await expect(createTestApp(db.url, { policyFilePath: changed })).rejects.toThrow(PolicyRegistrationError);
  });

  it('refuses to start when no policy is in force yet', async () => {
    const future = policyFile('future.yaml', stringify(policyDocument('v9', '2999-01-01T00:00:00Z')));
    await expect(createTestApp(db.url, { policyFilePath: future })).rejects.toThrow(NoActivePolicyError);
  });

  it('starts with a scheduled future version when an earlier one is still in force', async () => {
    await (await createTestApp(db.url, { policyFilePath: policyFile('now.yaml', stringify(policyDocument('now', '2026-01-01T00:00:00Z'))) })).close();
    const app = await createTestApp(db.url, { policyFilePath: policyFile('later.yaml', stringify(policyDocument('later', '2999-01-01T00:00:00Z', 7))) });
    await app.close();
  });
});
