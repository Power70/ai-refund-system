import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { createPgPool, type Database } from '../src/database/database.providers.js';
import { runMigrations } from '../src/database/run-migrations.js';
import * as schema from '../src/database/schema.js';
import { DEMO_HISTORY } from '../src/database/seed/demo-data.js';
import { seedDemoCatalog, seedDemoHistory } from '../src/database/seed/seed.js';
import { evaluateRequest } from '../src/policy/policy-engine.js';
import type { RegisteredPolicy } from '../src/policy/policy.service.js';
import type { RefundReason } from '../src/policy/policy-schema.js';
import { RequestFactsService } from '../src/refunds/request-facts.service.js';
import { policyService } from './support/policy-fixtures.js';
import { createTestDatabase, demoOrder, requestByPublicId, TEST_SEED, type TestDatabase } from './support/test-app.js';

const DAY_MS = 86_400_000;

/** Catalog, real policy and seeded history, with every policy scenario run through the real fact builder and engine. */
describe('demo world (e2e, real PostgreSQL)', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: Database;
  let policy: RegisteredPolicy;
  const now = new Date();

  beforeAll(async () => {
    testDb = await createTestDatabase();
    await runMigrations(testDb.url);
    pool = createPgPool(testDb.url);
    db = drizzle(pool, { schema });
    await seedDemoCatalog(db, now, TEST_SEED);
    const policies = policyService(db);
    await policies.registerPolicyFile();
    policy = await policies.activePolicy(now);
    await seedDemoHistory(db, policy, now);
  });

  afterAll(async () => {
    await pool?.end();
    await testDb?.drop();
  });

  describe('seeded history', () => {
    it.each(DEMO_HISTORY.map((h) => [h.publicId, h] as const))('%s is decided as expected by the real engine', async (publicId, entry) => {
      const { request, decision } = await requestByPublicId(db, publicId);
      expect(request).toMatchObject({ source: 'SEED', state: 'DECIDED', policyVersionId: policy.id, leaseOwner: null });
      expect(decision.status).toBe(entry.expected);
      expect(decision.ruleTrace!.policyVersion).toBe(policy.version);
    });

    it('#8 Hassan: escalated, then denied by a reviewer, so the item counts as previously denied', async () => {
      const { decision, resolution, lines } = await requestByPublicId(db, 'rr_8hssn0hdph01');
      expect(decision.escalationReasons).toEqual(['DEFAULT']);
      expect(resolution).toMatchObject({ outcome: 'DENIED', approvedAmountMinor: 0 });
      expect(lines.map((l) => l.finalLineStatus)).toEqual(['NOT_REFUNDED']);
    });

    it('#15 Obi: the whole kettle quantity is refunded', async () => {
      const { lines } = await requestByPublicId(db, 'rr_15bkett00001');
      const { items } = await demoOrder(db, 'WN-H9F3LX', ['KETTLE-ELC-1L']);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ finalLineStatus: 'REFUNDED', quantity: items[0].quantity });
    });

    it('re-seeding creates nothing and re-dates everything relative to the new time', async () => {
      const later = new Date(now.getTime() + 5 * DAY_MS);
      const summary = await seedDemoHistory(db, policy, later);
      expect(summary).toEqual({ created: 0, refreshed: DEMO_HISTORY.length });
      const { request } = await requestByPublicId(db, 'rr_6fem0chr0001');
      expect(Math.round((later.getTime() - request.createdAt.getTime()) / DAY_MS)).toBe(6);
      await seedDemoHistory(db, policy, now); // back to "now" for the scenarios below
    });
  });

  describe('every policy-level scenario from the plan, as the demo data stands today', () => {
    const scenarios: [string, string, string[], RefundReason, 'APPROVED' | 'DENIED' | 'ESCALATED', string[]][] = [
      ['#1 Ada, damaged shirt', 'WN-7K3P9Q', ['SHIRT-OXF-BLU-M'], 'DAMAGED', 'APPROVED', []],
      ['#2 Ben, 45 days after delivery', 'WN-Q4M1ZT', ['LAMP-DSK-BLK'], 'DAMAGED', 'DENIED', []],
      ['#3 Chika, final-sale belt', 'WN-9TB6RW', ['BELT-LTH-BRN'], 'CHANGED_MIND', 'DENIED', []],
      ['#4 Daniel, final-sale item damaged', 'WN-X8D3KF', ['JKT-DNM-IND-L'], 'DAMAGED', 'ESCALATED', ['FINAL_SALE_DEFECT_CONFLICT']],
      ['#5 Efe, $749 laptop', 'WN-L6W9PH', ['LAPTOP-14-512'], 'WRONG_ITEM', 'ESCALATED', ['HIGH_VALUE']],
      ['#6 Femi, $280 after $300 refunded', 'WN-8NF4QA', ['DESK-MAT-XL'], 'DAMAGED', 'ESCALATED', ['HIGH_VALUE']],
      ['#7 Grace, blue shirt', 'WN-4GK1VS', ['SHIRT-LIN-BLU-S'], 'CHANGED_MIND', 'APPROVED', []],
      ['#8 Hassan, resubmitted after a denial', 'WN-Z2T5HM', ['HEADPH-OVR-BLK'], 'DAMAGED', 'ESCALATED', ['PRIOR_DENIED_RESUBMISSION']],
      ['#9 Ifeoma, fifth request in 30 days', 'WN-6PQ8XE', ['CANDLE-SOY-VAN'], 'DAMAGED', 'ESCALATED', ['HIGH_FREQUENCY']],
      ['#10 Jide, not delivered', 'WN-K5R2BW', ['SPEAKER-BT-MINI'], 'DAMAGED', 'ESCALATED', ['NOT_DELIVERED']],
      ['#11 Kemi, shirt + final-sale belt', 'WN-3VH9TL', ['SHIRT-POL-GRN-M', 'BELT-CNV-NVY'], 'CHANGED_MIND', 'APPROVED', []],
      ['#12 Lara (policy level; the AI gate escalates the injection)', 'WN-7XW2QD', ['BOTTLE-STL-750'], 'DAMAGED', 'APPROVED', []],
      ['#13 Musa (policy level; the gate escalates the reason override)', 'WN-B4N6ZR', ['BAG-BPK-GRY'], 'DAMAGED', 'APPROVED', []],
      ['#14 Ngozi, exactly $500.00', 'WN-2JC8WP', ['TABLET-10-128'], 'DAMAGED', 'APPROVED', []],
    ];

    it.each(scenarios)('%s', async (_name, orderNumber, skus, reason, expected, escalation) => {
      const order = await demoOrder(db, orderNumber, skus);
      const facts = await new RequestFactsService(db).build({
        customerId: order.customerId, orderId: order.orderId, reason, at: now,
        lines: order.itemIds.map((orderItemId) => ({ orderItemId, quantity: 1 })),
      });
      const result = evaluateRequest(policy.document, facts.lines, facts.history);
      expect(result.status).toBe(expected);
      expect(result.escalationRuleIds).toEqual(escalation);
    });

    it('#11 Kemi: only the shirt is refunded', async () => {
      const order = await demoOrder(db, 'WN-3VH9TL', ['SHIRT-POL-GRN-M', 'BELT-CNV-NVY']);
      const facts = await new RequestFactsService(db).build({
        customerId: order.customerId, orderId: order.orderId, reason: 'CHANGED_MIND', at: now,
        lines: order.itemIds.map((orderItemId) => ({ orderItemId, quantity: 1 })),
      });
      expect(evaluateRequest(policy.document, facts.lines, facts.history).approvedAmountMinor).toBe(4500);
    });
  });
});
