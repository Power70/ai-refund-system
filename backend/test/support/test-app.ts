import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import request from 'supertest';
import { LlmError, type LlmAdapter, type ToolCallRequest, type ToolCallResult } from '../../src/ai/llm.types.js';
import type { AssistantTurn } from '../../src/conversations/chat-turn.js';
import { createPgPool, type Database } from '../../src/database/database.js';
import { runMigrations } from '../../src/database/run-migrations.js';
import * as schema from '../../src/database/schema.js';
import { seedDemoCatalog, seedDemoHistory } from '../../src/database/seed/seed.js';
import { findActivePolicy, registerPolicyVersion } from '../../src/policy/policy-registry.js';
import { parsePolicy, type RefundReason } from '../../src/policy/policy-schema.js';
import { generatePublicRequestId } from '../../src/refunds/refund-requests.js';

/** Server used for tests. Override with TEST_DATABASE_ADMIN_URL (must be allowed to CREATE DATABASE). */
const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://refund:refund_demo_password@127.0.0.1:5432/postgres';

export interface TestDatabase {
  url: string;
  drop: () => Promise<void>;
}

/** Creates an empty, uniquely named database so each test file is fully isolated. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `refund_test_${randomBytes(6).toString('hex')}`;
  await withAdmin((client) => client.query(`CREATE DATABASE "${name}"`));
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: () => withAdmin((client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)).then(() => undefined),
  };
}

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Finds a demo customer's order and the item ids for the given SKUs. */
export async function demoOrder(db: Database, orderNumber: string, skus: string[]) {
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.orderNumber, orderNumber));
  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
  const itemIds = skus.map((sku) => {
    const item = items.find((i) => i.sku === sku);
    if (!item) throw new Error(`${sku} not in ${orderNumber}`);
    return item.id;
  });
  return { orderId: order.id, customerId: order.customerId, itemIds, items };
}

export async function requestByPublicId(db: Database, publicId: string) {
  const [request] = await db.select().from(schema.refundRequests).where(eq(schema.refundRequests.publicId, publicId));
  const [decision] = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, request.id));
  const lines = await db.select().from(schema.refundRequestLines).where(and(eq(schema.refundRequestLines.requestId, request.id)));
  const [resolution] = await db.select().from(schema.reviewResolutions).where(eq(schema.reviewResolutions.requestId, request.id));
  return { request, decision, lines, resolution };
}

/** A fresh database with exactly what `docker-compose up` produces: migrations, catalog, policy, history. */
export async function prepareDemoDatabase(): Promise<TestDatabase> {
  const testDb = await createTestDatabase();
  await runMigrations(testDb.url);
  const pool = createPgPool(testDb.url);
  try {
    const db = drizzle(pool, { schema });
    const now = new Date();
    await seedDemoCatalog(db, now);
    await registerPolicyVersion(db, parsePolicy(readFileSync(new URL('../../../policy/refund-policy.yaml', import.meta.url), 'utf8')));
    await seedDemoHistory(db, await findActivePolicy(db, now), now);
  } finally {
    await pool.end();
  }
  return testDb;
}

export const CSRF = { 'X-Requested-With': 'refund-app' };

let visitor = 0;
/**
 * A distinct client IP per call (TEST-NET-2 range), so tests behave like separate visitors
 * and never trip the per-IP sign-in limit meant for real attackers.
 */
export function asVisitor(): { 'X-Forwarded-For': string } {
  visitor = (visitor % 250) + 1;
  return { 'X-Forwarded-For': `198.18.${Math.floor(Math.random() * 250)}.${visitor}` };
}

/** Signs in and returns the session cookie header value ("rs_session=..."). */
export async function signIn(app: NestExpressApplication, email: string, orderNumber: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/v1/customer/session').set(CSRF).set(asVisitor()).send({ email, orderNumber }).expect(200);
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('rs_session='));
  if (!cookie) throw new Error('no session cookie');
  return cookie.split(';')[0];
}

interface OrderItem { id: string; name: string; refundableQuantity: number }

/** A signed-in customer: find item ids by name and submit claims like the frontend will. */
export async function customerClient(app: NestExpressApplication, email: string, orderNumber: string) {
  const cookie = await signIn(app, email, orderNumber);
  const server = app.getHttpServer();
  const orders = (await request(server).get('/api/v1/customer/orders').set('Cookie', cookie).expect(200)).body.orders as { orderNumber: string; items: OrderItem[] }[];

  return {
    cookie,
    itemId(name: string): string {
      const item = orders.flatMap((o) => o.items).find((i) => i.name === name);
      if (!item) throw new Error(`no item ${name}`);
      return item.id;
    },
    submit(body: unknown, idempotencyKey: string | null = crypto.randomUUID()) {
      const req = request(server).post('/api/v1/customer/refund-requests').set('Cookie', cookie).set(CSRF);
      return (idempotencyKey === null ? req : req.set('Idempotency-Key', idempotencyKey)).send(body as object);
    },
    get(path = '') {
      return request(server).get(`/api/v1/customer/refund-requests${path}`).set('Cookie', cookie);
    },
  };
}

/**
 * A request left PROCESSING by a worker that died: what a crash between transaction 1
 * and transaction 2 leaves behind.
 */
export async function strandedRequest(
  db: Database,
  options: { orderNumber: string; sku: string; reason: RefundReason; leaseExpiresAt: Date; attemptCount?: number },
) {
  const order = await demoOrder(db, options.orderNumber, [options.sku]);
  const [version] = await db.select().from(schema.policyVersions).limit(1);
  const [request] = await db
    .insert(schema.refundRequests)
    .values({
      publicId: generatePublicRequestId(),
      customerId: order.customerId,
      orderId: order.orderId,
      policyVersionId: version.id,
      idempotencyKey: crypto.randomUUID(),
      payloadHash: 'd'.repeat(64),
      reasonConfirmed: options.reason,
      leaseOwner: 'dead-worker',
      leaseExpiresAt: options.leaseExpiresAt,
      attemptCount: options.attemptCount ?? 1,
    })
    .returning();
  const item = order.items.find((i) => i.sku === options.sku)!;
  await db.insert(schema.refundRequestLines).values({
    requestId: request.id, orderId: order.orderId, orderItemId: item.id, quantity: 1, amountMinor: item.unitPricePaidMinor,
  });
  return request;
}

// An output, an LlmError to throw, or a function of the request.
type Scripted = unknown;

/** Scripted model: answers the startup probe and case summaries itself; chat turns come from the queue. */
export class FakeLlm implements LlmAdapter {
  readonly requests: ToolCallRequest[] = [];
  private readonly queue: Scripted[] = [];

  next(...outputs: Scripted[]): this {
    this.queue.push(...outputs);
    return this;
  }

  /** Overrides for decision messages and follow-up answers; defaults pass the reply checks. */
  decisionMessage: string | null = null;
  followUpAnswer: { answer: string; isDispute: boolean } | null = null;

  /** Returned for case-summary calls, which run in the background after submissions. */
  summary: unknown = { summary: 'Customer reports a problem with the item.', suggestedAction: 'NEEDS_INFO', rationale: 'Details need checking.' };

  async callTool(request: ToolCallRequest): Promise<ToolCallResult> {
    if (request.toolName === 'report_ready') return { input: { ready: true } };
    if (request.toolName === 'record_case_summary') return { input: this.summary, inputTokens: 200, outputTokens: 40 };
    if (request.toolName === 'record_decision_message') return { input: { message: this.decisionMessage ?? defaultDecisionMessage(request.user) } };
    if (request.toolName === 'record_answer') return { input: this.followUpAnswer ?? { answer: 'Hi {{customer_first_name}}, happy to help with your request.', isDispute: false } };
    this.requests.push(request);
    const scripted = this.queue.shift();
    if (scripted === undefined) throw new LlmError('unavailable', 'FakeLlm: nothing queued');
    if (scripted instanceof LlmError) throw scripted;
    return { input: typeof scripted === 'function' ? (scripted as (r: ToolCallRequest) => unknown)(request) : scripted, inputTokens: 100, outputTokens: 50 };
  }
}

/** A valid decision message using every placeholder the prompt requires. */
function defaultDecisionMessage(prompt: string): string {
  const required = prompt.match(/Placeholders you must use: (.*)/)?.[1] ?? '';
  return `Hi {{customer_first_name}}, here is an update on your request. ${required === 'none' ? '' : required}`.trim();
}

const NO_FLAGS = { injectionAttempt: false, mentionsOtherCustomerOrder: false, abusive: false, offTopic: false };

/** A valid chat turn with defaults; override what the test cares about. */
export function turn(overrides: Partial<AssistantTurn> = {}): AssistantTurn {
  return { reply: 'Which item is this about?', quickReplies: [], needsClarification: true, proposal: null, flags: NO_FLAGS, summary: 'Customer started a refund chat.', ...overrides };
}

/** Finds an item ref ("O1.I2") in the prompt by item name. */
export function refFor(request: ToolCallRequest, itemName: string): { orderRef: string; itemRef: string } {
  const line = request.user.split('\n').find((l) => l.includes(`"${itemName}"`));
  const itemRef = line?.trim().split(' ')[0];
  if (!itemRef) throw new Error(`no ref for ${itemName}`);
  return { orderRef: itemRef.split('.')[0], itemRef };
}
