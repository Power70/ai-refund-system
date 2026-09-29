import type { NestExpressApplication } from '@nestjs/platform-express';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import request from 'supertest';
import { createPgPool, type Database } from '../src/database/database.providers.js';
import * as schema from '../src/database/schema.js';
import { createTestApp } from './create-test-app.js';
import { ADMIN, CSRF, customerClient, prepareDemoDatabase, strandedRequest, type TestDatabase } from './support/test-app.js';

const BASE = '/api/v1/admin/refund-requests';
const NOTE = 'Checked photos with the courier; blue shirt is unworn.';

interface BriefLine { lineId: string; itemName: string; finalLineStatus: string; lineOutcome: string }

describe('admin resolution API (e2e)', () => {
  let testDb: TestDatabase;
  let app: NestExpressApplication;
  let pool: pg.Pool;
  let db: Database;
  let grace: Awaited<ReturnType<typeof customerClient>>;
  let femi: Awaited<ReturnType<typeof customerClient>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    testDb = await prepareDemoDatabase();
    app = await createTestApp(testDb.url);
    pool = createPgPool(testDb.url);
    db = drizzle(pool, { schema }) as Database;

    // Fixtures: manual review without AI (Grace), order over $500 (Femi), denied (Ben).
    grace = await customerClient(app, 'customer+7@example.test');
    const both = [grace.itemId('Linen shirt, blue'), grace.itemId('Linen shirt, white')].map((itemId) => ({ itemId, quantity: 1 }));
    ids.grace = (await grace.submit({ orderNumber: 'WN-4GK1VS', reason: 'CHANGED_MIND', lines: both }).expect(201)).body.requestId;
    femi = await customerClient(app, 'customer+6@example.test');
    ids.femi = (await femi.submit({ orderNumber: 'WN-8NF4QA', reason: 'DAMAGED', lines: [{ itemId: femi.itemId('Standing desk mat, XL'), quantity: 1 }] }).expect(201)).body.requestId;
    const ben = await customerClient(app, 'customer+2@example.test');
    ids.ben = (await ben.submit({ orderNumber: 'WN-Q4M1ZT', reason: 'DAMAGED', lines: [{ itemId: ben.itemId('Desk lamp, black'), quantity: 1 }] }).expect(201)).body.requestId;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await testDb?.drop();
  });

  const brief = async (id: string) => (await request(app.getHttpServer()).get(`${BASE}/${id}`).set(ADMIN).expect(200)).body;
  const linesOf = async (id: string) => (await brief(id)).lines as BriefLine[];
  const resolve = (id: string, body: object) => request(app.getHttpServer()).post(`${BASE}/${id}/resolution`).set(ADMIN).set(CSRF).send(body);
  const refundable = async (client: typeof grace, name: string) => {
    const { body } = await request(app.getHttpServer()).get('/api/v1/customer/orders').set('Cookie', client.cookie).expect(200);
    return (body.orders as { items: { name: string; refundableQuantity: number }[] }[]).flatMap((o) => o.items).find((i) => i.name === name)!.refundableQuantity;
  };
  const waiting = async () =>
    ((await request(app.getHttpServer()).get(`${BASE}?view=needs-review`).set(ADMIN).expect(200)).body.items as { requestId: string }[]).map((r) => r.requestId);

  describe('refuses bad or unauthorised resolutions, and stores nothing', () => {
    it('needs the admin token and the CSRF header', async () => {
      const [line] = await linesOf(ids.grace);
      const body = { lineDecisions: [{ lineId: line.lineId, approve: true }], reviewerNote: NOTE };
      await request(app.getHttpServer()).post(`${BASE}/${ids.grace}/resolution`).set(CSRF).set('X-Forwarded-For', '192.0.2.10').send(body).expect(401);
      await request(app.getHttpServer()).post(`${BASE}/${ids.grace}/resolution`).set(ADMIN).send(body).expect(403);
    });

    it('rejects a missing or blank note, typed amounts and duplicate lines', async () => {
      const [a, b] = await linesOf(ids.grace);
      const decisions = [{ lineId: a.lineId, approve: true }, { lineId: b.lineId, approve: true }];
      await resolve(ids.grace, { lineDecisions: decisions }).expect(400);
      await resolve(ids.grace, { lineDecisions: decisions, reviewerNote: '   ' }).expect(400);
      await resolve(ids.grace, { lineDecisions: decisions, reviewerNote: NOTE, approvedAmountMinor: 1 }).expect(400);
      await resolve(ids.grace, { lineDecisions: [...decisions, { lineId: a.lineId, approve: false }], reviewerNote: NOTE }).expect(400);
      await resolve(ids.grace, { lineDecisions: [{ lineId: a.lineId, approve: 'yes' }, decisions[1]], reviewerNote: NOTE }).expect(400);
      await resolve(ids.grace, { lineDecisions: [], reviewerNote: NOTE }).expect(400);
    });

    it('insists on a decision for every line of this request, and only this request', async () => {
      const [a, b] = await linesOf(ids.grace);
      const [femiLine] = await linesOf(ids.femi);
      const partial = await resolve(ids.grace, { lineDecisions: [{ lineId: a.lineId, approve: true }], reviewerNote: NOTE }).expect(422);
      expect(partial.body.code).toBe('LINES_MISMATCH');
      await resolve(ids.grace, { lineDecisions: [{ lineId: a.lineId, approve: true }, { lineId: femiLine.lineId, approve: true }], reviewerNote: NOTE }).expect(422);
      await resolve(ids.grace, { lineDecisions: [{ lineId: a.lineId, approve: true }, { lineId: b.lineId, approve: true }, { lineId: femiLine.lineId, approve: true }], reviewerNote: NOTE }).expect(422);
    });

    it('only resolves escalations: not decided requests, not requests still processing', async () => {
      const [line] = await linesOf(ids.ben);
      const denied = await resolve(ids.ben, { lineDecisions: [{ lineId: line.lineId, approve: true }], reviewerNote: NOTE }).expect(409);
      expect(denied.body.code).toBe('NOT_ESCALATED');

      const busy = await strandedRequest(db, { orderNumber: 'WN-2JC8WP', sku: 'TABLET-10-128', reason: 'DAMAGED', leaseExpiresAt: new Date(Date.now() + 60_000) });
      const [busyLine] = await linesOf(busy.publicId);
      expect((await resolve(busy.publicId, { lineDecisions: [{ lineId: busyLine.lineId, approve: true }], reviewerNote: NOTE }).expect(409)).body.code).toBe('NOT_ESCALATED');
    });

    it('404s for unknown or malformed ids', async () => {
      const body = { lineDecisions: [{ lineId: crypto.randomUUID(), approve: true }], reviewerNote: NOTE };
      await resolve('rr_000000000000', body).expect(404);
      await resolve('not-an-id', body).expect(404);
    });

    it('left every rejected case untouched', async () => {
      expect(await waiting()).toEqual(expect.arrayContaining([ids.grace, ids.femi]));
      expect((await brief(ids.grace)).resolution).toBeNull();
      expect((await linesOf(ids.grace)).map((l) => l.finalLineStatus)).toEqual(['UNDER_REVIEW', 'UNDER_REVIEW']);
    });
  });

  describe('a partial approval', () => {
    let resolved: Awaited<ReturnType<typeof brief>>;

    beforeAll(async () => {
      const lines = await linesOf(ids.grace);
      const decisions = lines.map((l) => ({ lineId: l.lineId, approve: l.itemName === 'Linen shirt, blue' }));
      resolved = (await resolve(ids.grace, { lineDecisions: decisions, reviewerNote: `  ${NOTE}  ` }).expect(200)).body;
    });

    it('derives the outcome and amount from the lines, and returns the updated case', () => {
      expect(resolved.resolution).toMatchObject({
        outcome: 'PARTIALLY_APPROVED',
        approvedAmountMinor: 8000,
        reviewerNote: NOTE,
        customerMessage: "Our support team reviewed your request and approved a refund of $80.00 for: Linen shirt, blue. We couldn't approve a refund for: Linen shirt, white.",
      });
      expect((resolved.lines as BriefLine[]).map((l) => [l.itemName, l.finalLineStatus])).toEqual([
        ['Linen shirt, blue', 'REFUNDED'],
        ['Linen shirt, white', 'NOT_REFUNDED'],
      ]);
    });

    it('keeps the automated decision as it was and adds an admin audit event', () => {
      expect(resolved.decision).toMatchObject({ status: 'ESCALATED', escalationReasons: ['NO_AI_ASSESSMENT'] });
      const event = (resolved.audit as { type: string; actor: string; data: { outcome: string; lines: { policyOutcome: string }[] } }[]).at(-1)!;
      expect(event).toMatchObject({ type: 'REVIEW_RESOLVED', actor: 'ADMIN', data: { outcome: 'PARTIALLY_APPROVED', approvedAmountMinor: 8000 } });
      expect(event.data.lines.map((l) => l.policyOutcome)).toEqual(['ALLOW', 'ALLOW']);
    });

    it('shows the customer the result without the internal note', async () => {
      const { body } = await grace.get(`/${ids.grace}`).expect(200);
      expect(body).toMatchObject({ status: 'PARTIALLY_APPROVED', approvedAmountMinor: 8000, customerMessage: resolved.resolution.customerMessage });
      expect(body.lines).toEqual([
        { itemName: 'Linen shirt, blue', quantity: 1, outcome: 'REFUNDED' },
        { itemName: 'Linen shirt, white', quantity: 1, outcome: 'NOT_REFUNDED' },
      ]);
      expect(JSON.stringify(body)).not.toContain('courier');
    });

    it('frees the rejected quantity and keeps the refunded one used', async () => {
      expect(await refundable(grace, 'Linen shirt, blue')).toBe(0);
      expect(await refundable(grace, 'Linen shirt, white')).toBe(1);
    });

    it('leaves the review queue, and cannot be resolved twice', async () => {
      expect(await waiting()).not.toContain(ids.grace);
      const lines = await linesOf(ids.grace);
      const again = await resolve(ids.grace, { lineDecisions: lines.map((l) => ({ lineId: l.lineId, approve: true })), reviewerNote: NOTE }).expect(409);
      expect(again.body.code).toBe('ALREADY_RESOLVED');
    });
  });

  it('two reviewers resolving at once: exactly one wins', async () => {
    const [line] = await linesOf(ids.femi);
    const results = await Promise.all([
      resolve(ids.femi, { lineDecisions: [{ lineId: line.lineId, approve: false }], reviewerNote: 'Reviewer one: mat was used.' }),
      resolve(ids.femi, { lineDecisions: [{ lineId: line.lineId, approve: true }], reviewerNote: 'Reviewer two: approve it.' }),
    ]);
    expect(results.map((r) => r.status).toSorted((x, y) => x - y)).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!.body;
    expect(winner.audit.filter((e: { type: string }) => e.type === 'REVIEW_RESOLVED')).toHaveLength(1);
    // Whichever reviewer won, the stored lines match the stored resolution.
    const approved = winner.resolution.outcome === 'APPROVED';
    expect(winner.lines[0].finalLineStatus).toBe(approved ? 'REFUNDED' : 'NOT_REFUNDED');
    expect(await refundable(femi, 'Standing desk mat, XL')).toBe(approved ? 0 : 1);
    if (!approved) expect(winner.resolution).toMatchObject({ outcome: 'DENIED', approvedAmountMinor: 0, customerMessage: "Our support team reviewed your request and wasn't able to approve a refund." });
  });
});
