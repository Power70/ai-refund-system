import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import request from 'supertest';
import { runMigrations } from '../src/database/run-migrations.js';
import { createTestApp } from './create-test-app.js';
import { createTestDatabase, type TestDatabase } from './support/test-database.js';

/** Runs SQL on the test database's server as the same (admin-capable) user. */
async function asAdmin(url: string, sql: string): Promise<number> {
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    return (await client.query(sql)).rowCount ?? 0;
  } finally {
    await client.end();
  }
}

describe('database outage while running (e2e)', () => {
  let app: NestExpressApplication;
  let db: TestDatabase;
  let dbName: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    dbName = new URL(db.url).pathname.slice(1);
    await runMigrations(db.url);
    app = await createTestApp(db.url);
  });

  afterAll(async () => {
    await asAdmin(db.url, `ALTER DATABASE "${dbName}" ALLOW_CONNECTIONS true`).catch(() => undefined);
    await app?.close();
    await db?.drop();
  });

  it('survives lost connections, reports degraded during the outage, and recovers', async () => {
    const server = app.getHttpServer();
    await request(server).get('/api/v1/health').expect(200, { status: 'ok' });

    // Outage: refuse new connections and kill the API's existing ones.
    await asAdmin(db.url, `ALTER DATABASE "${dbName}" ALLOW_CONNECTIONS false`);
    const killed = await asAdmin(
      db.url,
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND application_name = 'ai-refund-api'`,
    );
    expect(killed).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Before the pool error handler existed, this crashed the process.
    const started = Date.now();
    await request(server).get('/api/v1/health').expect(503, { status: 'degraded' });
    expect(Date.now() - started).toBeLessThan(3_000);

    // Database back: the pool reconnects on its own.
    await asAdmin(db.url, `ALTER DATABASE "${dbName}" ALLOW_CONNECTIONS true`);
    await request(server).get('/api/v1/health').expect(200, { status: 'ok' });
  });
});
