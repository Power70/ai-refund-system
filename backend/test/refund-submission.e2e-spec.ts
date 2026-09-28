import type { NestExpressApplication } from '@nestjs/platform-express';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import request from 'supertest';
import { createPgPool, type Database } from '../src/database/database.providers.js';
import * as schema from '../src/database/schema.js';
import { generatePublicRequestId } from '../src/common/validation.js';
import { computePayloadHash } from '../src/refunds/refunds.service.js';
import { createTestApp } from './create-test-app.js';
import { customerClient, demoOrder, prepareDemoDatabase, CSRF, type TestDatabase } from './support/test-app.js';

describe('refund submission (e2e)', () => {
  let testDb: TestDatabase;
  let app: NestExpressApplication;
  let pool: pg.Pool;
  let db: Database;

  beforeAll(async () => {
    testDb = await prepareDemoDatabase();
    app = await createTestApp(testDb.url);
    pool = createPgPool(testDb.url);
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await testDb?.drop();
  });

  async function stored(publicId: string) {
    const [request] = await db.select().from(schema.refundRequests).where(eq(schema.refundRequests.publicId, publicId));
    const [decision] = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, request.id));
    const lines = await db.select().from(schema.refundRequestLines).where(eq(schema.refundRequestLines.requestId, request.id));
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, request.id)).orderBy(asc(schema.auditEvents.createdAt));
    return { request, decision, lines, audit };
  }

  it('#2 Ben: denied by policy (outside the window), with the policy reason', async () => {
    const ben = await customerClient(app, 'ben.carter@example.com', 'WN-Q4M1ZT');
    const res = await ben.submit({ orderNumber: 'WN-Q4M1ZT', reason: 'DAMAGED', lines: [{ itemId: ben.itemId('Desk lamp, black'), quantity: 1 }] }).expect(201);
    expect(res.body).toMatchObject({ status: 'DENIED', approvedAmountMinor: 0, orderNumber: 'WN-Q4M1ZT', lines: [{ itemName: 'Desk lamp, black', quantity: 1, outcome: 'NOT_REFUNDED' }] });
    expect(res.body.customerMessage).toContain('Refunds are available within 30 days of delivery.');
    expect(res.body.requestId).toMatch(/^rr_[0-9a-hjkmnp-tv-z]{12}$/);
  });

  it('#7 Grace: a manual claim the policy would approve goes to a person (no AI assessment yet)', async () => {
    const grace = await customerClient(app, 'grace.lee@example.com', 'WN-4GK1VS');
    const body = { orderNumber: 'WN-4GK1VS', reason: 'CHANGED_MIND', lines: [{ itemId: grace.itemId('Linen shirt, blue'), quantity: 1 }] };
    const key = crypto.randomUUID();
    const res = await grace.submit(body, key).expect(201);
    expect(res.body).toMatchObject({ status: 'ESCALATED', approvedAmountMinor: 0, lines: [{ outcome: 'UNDER_REVIEW' }] });
    expect(res.body.customerMessage).toBe("Your request needs a review by our support team. We'll get back to you within 2 business days.");

    const { request, decision, lines, audit } = await stored(res.body.requestId);
    expect(request).toMatchObject({ state: 'DECIDED', leaseOwner: null, leaseExpiresAt: null, reasonConfirmed: 'CHANGED_MIND' });
    expect(decision).toMatchObject({ status: 'ESCALATED', policyVersionId: request.policyVersionId, escalationReasons: ['NO_AI_ASSESSMENT'], messageSource: 'TEMPLATE' });
    expect(decision.gateResult).toMatchObject({ policyStatus: 'APPROVED', status: 'ESCALATED', reasons: ['NO_AI_ASSESSMENT'] });
    expect(lines).toMatchObject([{ lineOutcome: 'ALLOW', decidingRuleId: 'CHANGE_OF_MIND_ELIGIBLE', finalLineStatus: 'UNDER_REVIEW', amountMinor: 8000 }]);
    expect(audit.map((a) => a.type)).toEqual(['REQUEST_RECEIVED', 'POLICY_EVALUATED', 'SAFETY_GATE_APPLIED', 'DECISION_RECORDED']);

    // Same key + same claim: the stored answer, unchanged.
    const replay = await grace.submit(body, key).expect(200);
    expect(replay.body).toEqual(res.body);
    // Same key + different claim: refused.
    const changed = await grace.submit({ ...body, reason: 'DAMAGED' }, key).expect(409);
    expect(changed.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // A new key for the item that is now under review: already in progress.
    const again = await grace.submit(body).expect(409);
    expect(again.body.code).toBe('ALREADY_IN_PROGRESS');
  });

  it('never exposes internal decision data to the customer', async () => {
    const hassan = await customerClient(app, 'hassan.bello@example.com', 'WN-Z2T5HM');
    const res = await hassan.submit({ orderNumber: 'WN-Z2T5HM', reason: 'DAMAGED', lines: [{ itemId: hassan.itemId('Over-ear headphones'), quantity: 1 }] }).expect(201);
    expect(Object.keys(res.body).sort()).toEqual(['approvedAmountMinor', 'createdAt', 'customerMessage', 'lines', 'orderNumber', 'requestId', 'status']);
    const text = JSON.stringify(res.body);
    for (const secret of ['PRIOR_DENIED', 'NO_AI_ASSESSMENT', 'rule', 'policyVersion', 'lease', 'trace']) expect(text).not.toContain(secret);
  });

  it('#15 Obi: nothing left to refund, and more than was bought', async () => {
    const obi = await customerClient(app, 'obi.chukwu@example.com', 'WN-H9F3LX');
    const kettle = await obi.submit({ orderNumber: 'WN-H9F3LX', reason: 'DAMAGED', lines: [{ itemId: obi.itemId('Electric kettle, 1 L'), quantity: 1 }] }).expect(422);
    expect(kettle.body.code).toBe('NOTHING_LEFT_TO_REFUND');
    const toaster = await obi.submit({ orderNumber: 'WN-6TZ5DN', reason: 'DAMAGED', lines: [{ itemId: obi.itemId('Toaster, 2-slice'), quantity: 2 }] }).expect(422);
    expect(toaster.body).toMatchObject({ code: 'QUANTITY_TOO_HIGH', message: 'Only 1 of this item can be refunded.' });
  });

  it("refuses another customer's item or an unknown order with the same 404", async () => {
    const ada = await customerClient(app, 'ada.okafor@example.com', 'WN-7K3P9Q');
    const bensLamp = (await demoOrder(db, 'WN-Q4M1ZT', ['LAMP-DSK-BLK'])).itemIds[0];
    const theirs = await ada.submit({ orderNumber: 'WN-Q4M1ZT', reason: 'DAMAGED', lines: [{ itemId: bensLamp, quantity: 1 }] }).expect(404);
    const mixed = await ada.submit({ orderNumber: 'WN-7K3P9Q', reason: 'DAMAGED', lines: [{ itemId: bensLamp, quantity: 1 }] }).expect(404);
    expect(theirs.body).toEqual(mixed.body);
    expect(theirs.body.code).toBe('ORDER_OR_ITEM_NOT_FOUND');
  });

  it('validates the claim and the Idempotency-Key', async () => {
    const chika = await customerClient(app, 'chika.eze@example.com', 'WN-9TB6RW');
    const belt = chika.itemId('Leather belt, brown (clearance)');
    const ok = { orderNumber: 'WN-9TB6RW', reason: 'CHANGED_MIND', lines: [{ itemId: belt, quantity: 1 }] };
    expect((await chika.submit(ok, null).expect(400)).body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await chika.submit(ok, 'bad key!').expect(400)).body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    await chika.submit({ ...ok, lines: [] }).expect(400);
    await chika.submit({ ...ok, lines: [{ itemId: belt, quantity: 1 }, { itemId: belt, quantity: 1 }] }).expect(400);
    await chika.submit({ ...ok, reason: 'VIP' }).expect(400);
    const daniel = await customerClient(app, 'daniel.mensah@example.com', 'WN-X8D3KF');
    await daniel.submit({ orderNumber: 'WN-X8D3KF', reason: 'DAMAGED', lines: [{ itemId: daniel.itemId('Denim jacket (final sale)'), quantity: 1, amountMinor: 1 }] }).expect(400);
  });

  it('two simultaneous submissions for the same item: exactly one reserves it', async () => {
    const kemi = await customerClient(app, 'kemi.adeyemi@example.com', 'WN-3VH9TL');
    const body = { orderNumber: 'WN-3VH9TL', reason: 'CHANGED_MIND', lines: [{ itemId: kemi.itemId('Polo shirt, green'), quantity: 1 }] };
    const results = await Promise.all([kemi.submit(body), kemi.submit(body)]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('ALREADY_IN_PROGRESS');
  });

  it('simultaneous retries with the same key create one request', async () => {
    const lara = await customerClient(app, 'lara.smith@example.com', 'WN-7XW2QD');
    const body = { orderNumber: 'WN-7XW2QD', reason: 'DAMAGED', lines: [{ itemId: lara.itemId('Steel water bottle, 750 ml'), quantity: 1 }] };
    const key = crypto.randomUUID();
    const results = await Promise.all([lara.submit(body, key), lara.submit(body, key), lara.submit(body, key)]);
    expect(new Set(results.map((r) => r.body.requestId)).size).toBe(1);
    // One creates it; the retries get the same request: 200 if it was already decided,
    // or 202 if they arrived while it was still being decided.
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((r) => r.status !== 201)) expect([200, 202]).toContain(r.status);
    const rows = await db.select().from(schema.refundRequests).where(eq(schema.refundRequests.idempotencyKey, key));
    expect(rows).toHaveLength(1);
  });

  describe('a request whose worker died mid-way', () => {
    async function strandedRequest(orderNumber: string, sku: string, body: object, key: string, leaseExpiresAt: Date) {
      const order = await demoOrder(db, orderNumber, [sku]);
      const [version] = await db.select().from(schema.policyVersions).limit(1);
      const [row] = await db.insert(schema.refundRequests).values({
        publicId: generatePublicRequestId(), customerId: order.customerId, orderId: order.orderId, policyVersionId: version.id,
        idempotencyKey: key, payloadHash: computePayloadHash(body as never), reasonConfirmed: 'DAMAGED',
        leaseOwner: 'dead-worker', leaseExpiresAt,
      }).returning();
      await db.insert(schema.refundRequestLines).values({ requestId: row.id, orderId: order.orderId, orderItemId: order.itemIds[0], quantity: 1, amountMinor: 1 });
      return row;
    }

    it('is finished by a retry once its lease has expired', async () => {
      const musa = await customerClient(app, 'musa.ibrahim@example.com', 'WN-B4N6ZR');
      const body = { orderNumber: 'WN-B4N6ZR', reason: 'DAMAGED', lines: [{ itemId: musa.itemId('Backpack, grey'), quantity: 1 }] };
      const key = crypto.randomUUID();
      const row = await strandedRequest('WN-B4N6ZR', 'BAG-BPK-GRY', body, key, new Date(Date.now() - 1_000));

      const res = await musa.submit(body, key).expect(200);
      expect(res.body).toMatchObject({ requestId: row.publicId, status: 'ESCALATED' });
      const { request, audit } = await stored(row.publicId);
      expect(request).toMatchObject({ state: 'DECIDED', attemptCount: 2, leaseOwner: null });
      expect(audit.map((a) => a.type)).toContain('PROCESSING_RESUMED');
    });

    it('answers 202 "still processing" while the lease is still valid', async () => {
      const musa = await customerClient(app, 'musa.ibrahim@example.com', 'WN-B4N6ZR');
      const body = { orderNumber: 'WN-5QE1MK', reason: 'DAMAGED', lines: [{ itemId: musa.itemId('Baseball cap, black'), quantity: 1 }] };
      const key = crypto.randomUUID();
      await strandedRequest('WN-5QE1MK', 'CAP-BSB-BLK', body, key, new Date(Date.now() + 60_000));
      const res = await musa.submit(body, key).expect(202);
      expect(res.body).toMatchObject({ status: 'PROCESSING', customerMessage: null, lines: [{ outcome: 'PROCESSING' }] });
    });
  });

  it('lets a customer read their own requests, and only theirs', async () => {
    const ngozi = await customerClient(app, 'ngozi.obi@example.com', 'WN-2JC8WP');
    const created = await ngozi.submit({ orderNumber: 'WN-2JC8WP', reason: 'DAMAGED', lines: [{ itemId: ngozi.itemId('Tablet 10", 128 GB'), quantity: 1 }] }).expect(201);
    const one = await ngozi.get(`/${created.body.requestId}`).expect(200);
    expect(one.body).toEqual(created.body);
    const list = await ngozi.get().expect(200);
    expect(list.body.map((r: { requestId: string }) => r.requestId)).toContain(created.body.requestId);

    const efe = await customerClient(app, 'efe.adebayo@example.com', 'WN-L6W9PH');
    await efe.get(`/${created.body.requestId}`).expect(404);
    await efe.get('/not-an-id').expect(404);
    expect((await efe.get().expect(200)).body).toEqual([]);
  });

  it('requires a session and the anti-CSRF header', async () => {
    await request(app.getHttpServer()).post('/api/v1/customer/refund-requests').set(CSRF).send({}).expect(401);
    const ifeoma = await customerClient(app, 'ifeoma.nwosu@example.com', 'WN-6PQ8XE');
    await request(app.getHttpServer()).post('/api/v1/customer/refund-requests').set('Cookie', ifeoma.cookie).send({}).expect(403);
  });
});

describe('submission rate limit (e2e)', () => {
  let testDb: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    testDb = await prepareDemoDatabase();
    app = await createTestApp(testDb.url);
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.drop();
  });

  it('allows 5 submissions a minute per customer, then 429; other customers are unaffected', async () => {
    const jide = await customerClient(app, 'jide.afolabi@example.com', 'WN-K5R2BW');
    for (let i = 0; i < 5; i++) await jide.submit({ orderNumber: 'WN-K5R2BW', reason: 'DAMAGED', lines: [] }).expect(400);
    await jide.submit({ orderNumber: 'WN-K5R2BW', reason: 'DAMAGED', lines: [] }).expect(429);
    const ada = await customerClient(app, 'ada.okafor@example.com', 'WN-7K3P9Q');
    await ada.submit({ orderNumber: 'WN-7K3P9Q', reason: 'DAMAGED', lines: [] }).expect(400);
  });
});
