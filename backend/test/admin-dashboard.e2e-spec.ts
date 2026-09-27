import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './create-test-app.js';
import { customerClient } from './support/customer-client.js';
import { prepareDemoDatabase } from './support/prepare-demo-database.js';
import type { TestDatabase } from './support/test-database.js';

const ADMIN = { Authorization: 'Bearer admin-demo-token' };
const QUEUE = '/api/v1/admin/refund-requests';

interface Row { requestId: string; status: string; source: string; customerName: string; customerEmail: string; reasons: string[]; resolution: string | null; createdAt: string; requestedAmountMinor: number }

describe('admin dashboard API (e2e)', () => {
  let testDb: TestDatabase;
  let app: NestExpressApplication;
  const created: Record<string, string> = {};

  beforeAll(async () => {
    testDb = await prepareDemoDatabase();
    app = await createTestApp(testDb.url);

    // Real customer activity, oldest first: Grace (manual approval → person), Ben (denied), Femi (over $500).
    const grace = await customerClient(app, 'grace.lee@example.com', 'WN-4GK1VS');
    created.grace = (await grace.submit({ orderNumber: 'WN-4GK1VS', reason: 'CHANGED_MIND', lines: [{ itemId: grace.itemId('Linen shirt, blue'), quantity: 1 }] }).expect(201)).body.requestId;
    const ben = await customerClient(app, 'ben.carter@example.com', 'WN-Q4M1ZT');
    created.ben = (await ben.submit({ orderNumber: 'WN-Q4M1ZT', reason: 'DAMAGED', lines: [{ itemId: ben.itemId('Desk lamp, black'), quantity: 1 }] }).expect(201)).body.requestId;
    const femi = await customerClient(app, 'femi.johnson@example.com', 'WN-8NF4QA');
    created.femi = (await femi.submit({ orderNumber: 'WN-8NF4QA', reason: 'DAMAGED', lines: [{ itemId: femi.itemId('Standing desk mat, XL'), quantity: 1 }] }).expect(201)).body.requestId;
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.drop();
  });

  const queue = (query = '') => request(app.getHttpServer()).get(`${QUEUE}${query}`).set(ADMIN);

  describe('access', () => {
    it('refuses a missing or wrong token, and says how to authenticate', async () => {
      await request(app.getHttpServer()).get(QUEUE).set('X-Forwarded-For', '192.0.2.1').expect(401);
      const res = await request(app.getHttpServer()).get(QUEUE).set('X-Forwarded-For', '192.0.2.1').set('Authorization', 'Bearer admin-demo-tokeN').expect(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      await request(app.getHttpServer()).get(QUEUE).set('X-Forwarded-For', '192.0.2.1').set('Authorization', 'admin-demo-token').expect(401);
    });

    it("a customer's session cookie is not an admin credential", async () => {
      const ada = await customerClient(app, 'ada.okafor@example.com', 'WN-7K3P9Q');
      await request(app.getHttpServer()).get(QUEUE).set('X-Forwarded-For', '192.0.2.2').set('Cookie', ada.cookie).expect(401);
    });

    it('locks an IP after 10 wrong tokens, even for the right token; other IPs are unaffected', async () => {
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer()).get(QUEUE).set('X-Forwarded-For', '192.0.2.99').set('Authorization', `Bearer guess-${i}-xxxxxxxx`).expect(401);
      }
      await request(app.getHttpServer()).get(QUEUE).set('X-Forwarded-For', '192.0.2.99').set(ADMIN).expect(429);
      await request(app.getHttpServer()).get(QUEUE).set('X-Forwarded-For', '192.0.2.100').set(ADMIN).expect(200);
    });
  });

  describe('queue', () => {
    it('"all": seeded history and new requests, newest first, clearly marked', async () => {
      const { body } = await queue('?pageSize=100').expect(200);
      expect(body.total).toBe(10);
      const rows = body.items as Row[];
      expect(rows[0].requestId).toBe(created.femi);
      const times = rows.map((r) => r.createdAt);
      expect(times).toEqual(times.toSorted().toReversed());
      expect(rows.filter((r) => r.source === 'SEED')).toHaveLength(7);
      expect(rows.find((r) => r.requestId === created.ben)).toMatchObject({ status: 'DENIED', reasons: ['WINDOW_EXPIRED'], customerEmail: 'ben.carter@example.com' });
    });

    it('"needs-review": only unresolved escalations, oldest first, with why', async () => {
      const { body } = await queue('?view=needs-review').expect(200);
      expect((body.items as Row[]).map((r) => [r.requestId, r.reasons])).toEqual([
        [created.grace, ['NO_AI_ASSESSMENT']],
        [created.femi, ['HIGH_VALUE']],
      ]);
      // Hassan's seeded escalation was already resolved by a reviewer, so it is not waiting.
      const all = (await queue('?q=hassan').expect(200)).body.items as Row[];
      expect(all[0]).toMatchObject({ status: 'ESCALATED', resolution: 'DENIED' });
    });

    it('filters by status', async () => {
      const { body } = await queue('?status=DENIED').expect(200);
      expect((body.items as Row[]).every((r) => r.status === 'DENIED')).toBe(true);
      expect((body.items as Row[]).map((r) => r.requestId)).toContain(created.ben);
    });

    it('searches request id, order number, name and email, case-insensitively', async () => {
      expect((await queue(`?q=${created.grace}`).expect(200)).body.items.map((r: Row) => r.requestId)).toEqual([created.grace]);
      expect((await queue('?q=wn-8nf4qa').expect(200)).body.total).toBe(2); // Femi: seeded chair + new mat
      expect((await queue('?q=FEMI.JOHNSON@').expect(200)).body.total).toBe(2);
      expect((await queue('?q=Ifeoma').expect(200)).body.total).toBe(4);
    });

    it('treats search wildcards literally', async () => {
      expect((await queue('?q=%25').expect(200)).body.total).toBe(0); // "%"
      // As a wildcard "_" would match the "-" in Femi's order WN-8NF4QA; taken literally nothing matches.
      expect((await queue('?q=wn_8nf4qa').expect(200)).body.total).toBe(0);
      expect((await queue('?q=rr_').expect(200)).body.total).toBe(10); // a literal "_" still matches
    });

    it('paginates', async () => {
      const first = (await queue('?pageSize=4&page=1').expect(200)).body;
      const second = (await queue('?pageSize=4&page=2').expect(200)).body;
      const third = (await queue('?pageSize=4&page=3').expect(200)).body;
      const ids = [...first.items, ...second.items, ...third.items].map((r: Row) => r.requestId);
      expect(new Set(ids).size).toBe(10);
      expect(third.items).toHaveLength(2);
      expect(first).toMatchObject({ page: 1, pageSize: 4, total: 10 });
    });

    it('rejects nonsense query parameters', async () => {
      await queue('?view=everything').expect(400);
      await queue('?pageSize=1000').expect(400);
      await queue('?page=0').expect(400);
      await queue('?status=MAYBE').expect(400);
      await queue(`?q=${'x'.repeat(101)}`).expect(400);
    });
  });

  describe('case brief', () => {
    it('shows everything a reviewer needs for a fresh escalation', async () => {
      const { body } = await request(app.getHttpServer()).get(`${QUEUE}/${created.grace}`).set(ADMIN).expect(200);
      expect(body.customer).toEqual({ name: 'Grace Lee', email: 'grace.lee@example.com' });
      expect(body.order).toMatchObject({ orderNumber: 'WN-4GK1VS', currency: 'USD' });
      expect(body.request).toMatchObject({ source: 'CUSTOMER', state: 'DECIDED', reasonConfirmed: 'CHANGED_MIND', attempts: 1 });
      expect(body).toMatchObject({ conversation: null, aiSummary: null, aiSummarySuppressed: false, claim: { proposed: null, reasonOverridden: false, itemsNotDiscussed: [] } });
      expect(body.lines).toEqual([
        expect.objectContaining({
          itemName: 'Linen shirt, blue', sku: 'SHIRT-LIN-BLU-S', quantity: 1, amountMinor: 8000,
          lineOutcome: 'ALLOW', decidingRuleId: 'CHANGE_OF_MIND_ELIGIBLE', finalLineStatus: 'UNDER_REVIEW',
          publicReason: 'Items returned within 30 days qualify for a refund.',
        }),
      ]);
      expect(body.decision).toMatchObject({
        status: 'ESCALATED', escalationReasons: ['NO_AI_ASSESSMENT'], policyVersion: '2026.09-1', messageSource: 'TEMPLATE',
        gateResult: { policyStatus: 'APPROVED', status: 'ESCALATED', reasons: ['NO_AI_ASSESSMENT'], assessment: 'MANUAL' },
      });
      expect(body.decision.ruleTrace.lines[0].trace.length).toBeGreaterThan(5);
      expect(body.resolution).toBeNull();
      expect(body.audit.map((a: { type: string }) => a.type)).toEqual(['REQUEST_RECEIVED', 'POLICY_EVALUATED', 'SAFETY_GATE_APPLIED', 'DECISION_RECORDED']);
    });

    it("shows a seeded request with the reviewer's resolution", async () => {
      const { body } = await request(app.getHttpServer()).get(`${QUEUE}/rr_8hssn0hdph01`).set(ADMIN).expect(200);
      expect(body.request.source).toBe('SEED');
      expect(body.resolution).toMatchObject({
        outcome: 'DENIED', approvedAmountMinor: 0,
        lines: [{ itemName: 'Over-ear headphones', approve: false }],
      });
      expect(body.resolution.reviewerNote).toContain('not a defect');
    });

    it('404s for unknown or malformed ids, and needs the admin token', async () => {
      await request(app.getHttpServer()).get(`${QUEUE}/rr_zzzzzzzzzzzz`).set(ADMIN).expect(404);
      await request(app.getHttpServer()).get(`${QUEUE}/../../health`).set(ADMIN).expect(404);
      await request(app.getHttpServer()).get(`${QUEUE}/${created.grace}`).set('X-Forwarded-For', '192.0.2.3').expect(401);
    });
  });
});
