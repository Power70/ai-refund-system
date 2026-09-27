import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { runMigrations } from '../src/database/run-migrations.js';
import { createTestApp } from './create-test-app.js';
import { createTestDatabase, type TestDatabase } from './support/test-database.js';

describe('HTTP foundation (e2e)', () => {
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

  it('GET /api/v1/health returns ok and nothing internal', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('sends security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('does not force HTTPS, so the plain-HTTP demo works', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('serves routes only under the /api/v1 prefix', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('rejects JSON bodies over 32kb', async () => {
    const big = JSON.stringify({ text: 'x'.repeat(40 * 1024) });
    await request(app.getHttpServer())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(big)
      .expect(413);
  });
});

describe('health when the database is down (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    // Nothing listens on port 1, so every connection attempt is refused.
    app = await createTestApp('postgresql://nobody@127.0.0.1:1/none');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers 503 degraded quickly, without leaking why', async () => {
    const started = Date.now();
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(503);
    expect(res.body).toEqual({ status: 'degraded' });
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
