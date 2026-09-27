import type { NestExpressApplication } from '@nestjs/platform-express';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import request from 'supertest';
import { createPgPool } from '../src/database/create-pg-pool.js';
import type { Database } from '../src/database/database.types.js';
import * as schema from '../src/database/schema/index.js';
import { createTestApp } from './create-test-app.js';
import { customerClient } from './support/customer-client.js';
import { prepareDemoDatabase } from './support/prepare-demo-database.js';
import { strandedRequest } from './support/stranded-request.js';
import type { TestDatabase } from './support/test-database.js';

const ADMIN = { Authorization: 'Bearer admin-demo-token' };

describe('admin metrics and health (e2e)', () => {
  let testDb: TestDatabase;
  let app: NestExpressApplication;
  let pool: pg.Pool;
  let db: Database;
  let hassanReason: string;
  let policyVersion: string;

  beforeAll(async () => {
    testDb = await prepareDemoDatabase();
    app = await createTestApp(testDb.url);
    pool = createPgPool(testDb.url);
    db = drizzle(pool, { schema }) as Database;
    const brief = (await request(app.getHttpServer()).get('/api/v1/admin/refund-requests/rr_8hssn0hdph01').set(ADMIN).expect(200)).body;
    [hassanReason] = brief.decision.escalationReasons;
    policyVersion = brief.decision.policyVersion;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await testDb?.drop();
  });

  const metrics = async () => (await request(app.getHttpServer()).get('/api/v1/admin/metrics').set(ADMIN).expect(200)).body;
  const health = async () => (await request(app.getHttpServer()).get('/api/v1/admin/health').set(ADMIN).expect(200)).body;

  it('both need the admin token', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/metrics').set('X-Forwarded-For', '192.0.2.20').expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/health').set('X-Forwarded-For', '192.0.2.20').expect(401);
  });

  it('the public health check still reveals nothing internal', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/health').expect(200)).body).toEqual({ status: 'ok' });
  });

  describe('with only the seeded demo history', () => {
    it('counts the history: six approvals and one escalation a person already denied', async () => {
      const body = await metrics();
      expect(body.requests).toEqual({ total: 7, last24Hours: 0, processing: 0, approved: 6, denied: 0, escalated: 1, awaitingReview: 0 });
      expect(body.resolutions).toEqual({ approved: 0, partiallyApproved: 0, denied: 1 });
      expect(body.topEscalationReasons).toEqual([{ reason: hassanReason, count: 1 }]);
      expect(body.stuckProcessingCount).toBe(0);
      expect(body.ai).toEqual({ status: 'disabled', provider: null, model: null });
      expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
    });

    it('health is ok: database up, policy in force, nothing stuck, AI disabled is not a fault', async () => {
      expect(await health()).toMatchObject({
        status: 'ok',
        database: 'ok',
        ai: { status: 'disabled', provider: null, model: null },
        policyVersion,
        stuckProcessingCount: 0,
      });
    });
  });

  describe('after new activity and a crashed worker', () => {
    beforeAll(async () => {
      const ben = await customerClient(app, 'ben.carter@example.com', 'WN-Q4M1ZT');
      await ben.submit({ orderNumber: 'WN-Q4M1ZT', reason: 'DAMAGED', lines: [{ itemId: ben.itemId('Desk lamp, black'), quantity: 1 }] }).expect(201);
      const femi = await customerClient(app, 'femi.johnson@example.com', 'WN-8NF4QA');
      await femi.submit({ orderNumber: 'WN-8NF4QA', reason: 'DAMAGED', lines: [{ itemId: femi.itemId('Standing desk mat, XL'), quantity: 1 }] }).expect(201);
      const grace = await customerClient(app, 'grace.lee@example.com', 'WN-4GK1VS');
      await grace.submit({ orderNumber: 'WN-4GK1VS', reason: 'CHANGED_MIND', lines: [{ itemId: grace.itemId('Linen shirt, blue'), quantity: 1 }] }).expect(201);
      await strandedRequest(db, { orderNumber: 'WN-2JC8WP', sku: 'TABLET-10-128', reason: 'DAMAGED', leaseExpiresAt: new Date(Date.now() - 1_000) });
    });

    it('counts the new requests, what is waiting for a person, and why', async () => {
      const body = await metrics();
      expect(body.requests).toEqual({ total: 11, last24Hours: 4, processing: 1, approved: 6, denied: 1, escalated: 3, awaitingReview: 2 });
      expect(body.topEscalationReasons).toEqual(
        expect.arrayContaining([{ reason: 'HIGH_VALUE', count: 1 }, { reason: 'NO_AI_ASSESSMENT', count: 1 }, { reason: hassanReason, count: 1 }]),
      );
      const counts = (body.topEscalationReasons as { count: number }[]).map((r) => r.count);
      expect(counts).toEqual(counts.toSorted((a, b) => b - a));
      expect(body.stuckProcessingCount).toBe(1);
    });

    it('health turns degraded while a request is stuck', async () => {
      expect(await health()).toMatchObject({ status: 'degraded', database: 'ok', stuckProcessingCount: 1 });
    });
  });
});
