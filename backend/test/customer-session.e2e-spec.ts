import type { NestExpressApplication } from '@nestjs/platform-express';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import request from 'supertest';
import { hashSessionToken } from '../src/auth/session-token.js';
import { SessionsService } from '../src/auth/sessions.service.js';
import { createPgPool } from '../src/database/database.providers.js';
import * as schema from '../src/database/schema.js';
import { createTestApp } from './create-test-app.js';
import { asVisitor, CSRF, CUSTOMER_PASSWORD, prepareDemoDatabase, signIn, type TestDatabase } from './support/test-app.js';

const LOGIN = '/api/v1/customer/session';
const INVALID = { statusCode: 401, message: 'Invalid credentials.', error: 'Unauthorized' };

function cookiesOf(res: request.Response): string[] {
  return ([] as string[]).concat(res.headers['set-cookie'] ?? []);
}

describe('customer sign-in (e2e)', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    db = await prepareDemoDatabase();
    app = await createTestApp(db.url);
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('signs in with email + password and sets a locked-down session cookie', async () => {
    const res = await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: 'customer+1@example.test', password: CUSTOMER_PASSWORD }).expect(200);
    expect(res.body.firstName).toBe('Ada');
    expect(Date.parse(res.body.expiresAt) - Date.now()).toBeGreaterThan(29 * 60_000);
    const cookie = cookiesOf(res).find((c) => c.startsWith('rs_session='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api/);
    // The cookie lives as long as the session: until the idle window ends.
    expect(Date.parse(/Expires=([^;]+)/.exec(cookie)![1])).toBe(Math.floor(Date.parse(res.body.expiresAt) / 1000) * 1000);
    expect(cookie).not.toMatch(/Secure/); // plain-HTTP demo
    expect(JSON.stringify(res.body)).not.toContain('@');
  });

  it('marks the cookie Secure when the request came through an HTTPS proxy', async () => {
    const res = await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).set('X-Forwarded-Proto', 'https').send({ email: 'customer+2@example.test', password: CUSTOMER_PASSWORD }).expect(200);
    expect(cookiesOf(res).find((c) => c.startsWith('rs_session='))).toMatch(/Secure/);
  });

  it('ignores case and surrounding spaces', async () => {
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: '  Customer+2@EXAMPLE.test ', password: CUSTOMER_PASSWORD }).expect(200);
  });

  it('answers "Invalid credentials." whether the email or the password is wrong, and sets no cookie', async () => {
    const attempts = [
      { email: 'customer+1@example.test', password: 'wrong-password' }, // wrong password
      { email: 'nobody@example.com', password: CUSTOMER_PASSWORD }, // unknown email
      { email: 'customer+1@example.test', password: 'Customer' }, // passwords are case-sensitive
    ];
    for (const body of attempts) {
      const res = await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send(body).expect(401);
      expect(res.body).toEqual(INVALID);
      expect(cookiesOf(res).some((c) => c.startsWith('rs_session='))).toBe(false);
    }
  });

  it('rejects malformed input with 400 before looking anything up', async () => {
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: 'not-an-email', password: CUSTOMER_PASSWORD }).expect(400);
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: 'customer+1@example.test' }).expect(400);
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: 'customer+1@example.test', password: CUSTOMER_PASSWORD, isAdmin: true }).expect(400);
  });

  it('refuses a state-changing request without the anti-CSRF header', async () => {
    const res = await request(app.getHttpServer()).post(LOGIN).set(asVisitor()).send({ email: 'customer+1@example.test', password: CUSTOMER_PASSWORD }).expect(403);
    expect(cookiesOf(res)).toEqual([]);
    await request(app.getHttpServer()).post(LOGIN).set(asVisitor()).set('X-Requested-With', 'XMLHttpRequest').send({ email: 'customer+1@example.test', password: CUSTOMER_PASSWORD }).expect(403);
  });

  it('tells a signed-in customer who they are, and nobody else', async () => {
    const cookie = await signIn(app, 'customer+7@example.test');
    await request(app.getHttpServer()).get(LOGIN).set('Cookie', cookie).expect(200, { firstName: 'Grace' });
    await request(app.getHttpServer()).get(LOGIN).expect(401);
    const [name, value] = cookie.split('=');
    await request(app.getHttpServer()).get(LOGIN).set('Cookie', `${name}=${value.slice(0, -2)}xx`).expect(401);
  });

  it('signs out on the server: the cookie is cleared and a saved copy of it stops working', async () => {
    const cookie = await signIn(app, 'customer+8@example.test');
    await request(app.getHttpServer()).get(LOGIN).set('Cookie', cookie).expect(200);
    const res = await request(app.getHttpServer()).delete(LOGIN).set(CSRF).set('Cookie', cookie).expect(204);
    const cleared = cookiesOf(res).find((c) => c.startsWith('rs_session='))!;
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cleared).toMatch(/Path=\/api/);
    await request(app.getHttpServer()).get(LOGIN).set('Cookie', cookie).expect(401);
  });

  it('stores only a hash of the session token', async () => {
    const cookie = await signIn(app, 'customer+9@example.test');
    const token = cookie.split('=')[1];
    const pool = new pg.Pool({ connectionString: db.url });
    try {
      const { rows } = await pool.query<{ token_hash: string; kind: string }>('SELECT token_hash, kind FROM sessions WHERE token_hash = $1', [hashSessionToken(token)]);
      expect(rows).toEqual([{ token_hash: hashSessionToken(token), kind: 'CUSTOMER' }]);
      expect((await pool.query('SELECT 1 FROM sessions WHERE token_hash = $1', [token])).rowCount).toBe(0);
    } finally {
      await pool.end();
    }
  });
});

describe('server-side sessions (e2e)', () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let sessions: SessionsService;
  let customerId: string;
  const t0 = new Date('2026-09-29T12:00:00Z');
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

  beforeAll(async () => {
    db = await prepareDemoDatabase();
    pool = createPgPool(db.url);
    sessions = new SessionsService(drizzle(pool, { schema }));
    customerId = (await pool.query<{ id: string }>('SELECT id FROM customers LIMIT 1')).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it('ends after 30 idle minutes', async () => {
    const { token } = await sessions.create('CUSTOMER', customerId, t0);
    expect(await sessions.verify('CUSTOMER', token, at(14))).toEqual({ customerId, renewedUntil: null });
    expect(await sessions.verify('CUSTOMER', token, at(30))).toBeNull();
  });

  it('slides forward once less than half the idle window is left, but never past 12 hours from sign-in', async () => {
    const { token } = await sessions.create('CUSTOMER', customerId, t0);
    expect((await sessions.verify('CUSTOMER', token, at(10)))?.renewedUntil).toBeNull();
    expect((await sessions.verify('CUSTOMER', token, at(20)))?.renewedUntil).toEqual(at(50));
    expect(await sessions.verify('CUSTOMER', token, at(45))).not.toBeNull();

    let now = 45;
    while (now < 12 * 60 - 20) {
      now += 20;
      expect(await sessions.verify('CUSTOMER', token, at(now)), `minute ${now}`).not.toBeNull();
    }
    expect(await sessions.verify('CUSTOMER', token, at(12 * 60))).toBeNull();
  });

  it('keeps customer and admin sessions apart, and revokes one without touching others', async () => {
    const customer = await sessions.create('CUSTOMER', customerId, t0);
    const admin = await sessions.create('ADMIN', null, t0);
    expect(await sessions.verify('ADMIN', customer.token, at(1))).toBeNull();
    expect(await sessions.verify('CUSTOMER', admin.token, at(1))).toBeNull();
    await sessions.revoke(customer.token);
    expect(await sessions.verify('CUSTOMER', customer.token, at(1))).toBeNull();
    expect(await sessions.verify('ADMIN', admin.token, at(1))).not.toBeNull();
  });

  it('purges sessions that can no longer be used', async () => {
    const stale = await sessions.create('CUSTOMER', customerId, at(-120));
    const live = await sessions.create('CUSTOMER', customerId, t0);
    expect(await sessions.purgeExpired(at(1))).toBeGreaterThanOrEqual(1);
    expect(await sessions.verify('CUSTOMER', stale.token, at(-100))).toBeNull();
    expect(await sessions.verify('CUSTOMER', live.token, at(1))).not.toBeNull();
  });

  it('refuses a session for a customer that no longer exists', async () => {
    const [other] = (await pool.query<{ id: string }>("INSERT INTO customers (name, email) VALUES ('Gone', 'gone@example.test') RETURNING id")).rows;
    const { token } = await sessions.create('CUSTOMER', other.id, t0);
    await pool.query('DELETE FROM customers WHERE id = $1', [other.id]);
    expect(await sessions.verify('CUSTOMER', token, at(1))).toBeNull();
  });
});

describe('sign-in rate limits (e2e)', () => {
  let db: TestDatabase;
  let app: NestExpressApplication;

  beforeEach(async () => {
    db = await prepareDemoDatabase();
    app = await createTestApp(db.url);
  });

  afterEach(async () => {
    await app?.close();
    await db?.drop();
  });

  it('allows 10 attempts per minute from one IP, then answers 429', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '203.0.113.7').send({ email: `guess${i}@example.com`, password: CUSTOMER_PASSWORD }).expect(401);
    }
    const res = await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '203.0.113.7').send({ email: 'customer+1@example.test', password: CUSTOMER_PASSWORD }).expect(429);
    expect(res.body.message).toBe('Too many requests. Please wait a moment and try again.');
    // A different IP is unaffected.
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '203.0.113.8').send({ email: 'customer+1@example.test', password: CUSTOMER_PASSWORD }).expect(200);
  });

  it('locks an email after 5 failed attempts from any IPs; even the right password is then refused', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', `198.51.100.${i}`).send({ email: 'customer+1@example.test', password: `guess-${i}` }).expect(401);
    }
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '198.51.100.99').send({ email: 'CUSTOMER+1@example.test', password: CUSTOMER_PASSWORD }).expect(429);
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '198.51.100.99').send({ email: 'customer+2@example.test', password: CUSTOMER_PASSWORD }).expect(200);
  });

  it('never locks out a customer for signing in successfully many times', async () => {
    for (let i = 0; i < 8; i++) {
      await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', `198.51.101.${i}`).send({ email: 'customer+1@example.test', password: CUSTOMER_PASSWORD }).expect(200);
    }
  });
});
