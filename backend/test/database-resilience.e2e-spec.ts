import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import request from 'supertest';
import { runMigrations } from '../src/database/run-migrations.js';
import { createTestApp } from './create-test-app.js';
import { createTestDatabase, type TestDatabase } from './support/test-database.js';

describe('database connection loss (e2e)', () => {
  let app: NestExpressApplication;
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await runMigrations(db.url);
    app = await createTestApp(db.url);
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('survives the database killing its idle connections, and recovers', async () => {
    // Leaves an idle connection in the pool.
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    // What a Postgres restart or failover does to existing connections.
    const admin = new pg.Client({ connectionString: db.url });
    await admin.connect();
    const { rowCount } = await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND application_name = 'ai-refund-api'",
    );
    await admin.end();
    expect(rowCount).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Before the fix this crashed the process with an unhandled 'error' event.
    await request(app.getHttpServer()).get('/api/v1/health').expect(200, { status: 'ok' });
  });
});
