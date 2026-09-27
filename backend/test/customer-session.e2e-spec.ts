import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './create-test-app.js';
import { prepareDemoDatabase } from './support/prepare-demo-database.js';
import { asVisitor, CSRF, signIn } from './support/sign-in.js';
import type { TestDatabase } from './support/test-database.js';

const LOGIN = '/api/v1/customer/session';
const NOT_FOUND = { statusCode: 404, message: "We couldn't find an order with those details.", error: 'Not Found' };

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

  it('signs in with email + order number and sets a locked-down session cookie', async () => {
    const res = await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: 'ada.okafor@example.com', orderNumber: 'WN-7K3P9Q' }).expect(200);
    expect(res.body.firstName).toBe('Ada');
    expect(Date.parse(res.body.expiresAt) - Date.now()).toBeGreaterThan(29 * 60_000);
    const cookie = cookiesOf(res).find((c) => c.startsWith('rs_session='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api/);
    expect(cookie).toMatch(/Max-Age=1800/);
    expect(cookie).not.toMatch(/Secure/); // plain-HTTP demo
    expect(JSON.stringify(res.body)).not.toContain('@');
  });

  it('marks the cookie Secure when the request came through an HTTPS proxy', async () => {
    const res = await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).set('X-Forwarded-Proto', 'https').send({ email: 'ben.carter@example.com', orderNumber: 'WN-Q4M1ZT' }).expect(200);
    expect(cookiesOf(res).find((c) => c.startsWith('rs_session='))).toMatch(/Secure/);
  });

  it('ignores case and surrounding spaces', async () => {
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: '  Ada.Okafor@EXAMPLE.com ', orderNumber: ' wn-7k3p9q ' }).expect(200);
  });

  it('gives the same answer whether the email or the order number is wrong, and sets no cookie', async () => {
    const attempts = [
      { email: 'ada.okafor@example.com', orderNumber: 'WN-ZZZZZZ' }, // wrong order
      { email: 'nobody@example.com', orderNumber: 'WN-7K3P9Q' }, // wrong email
      { email: 'ada.okafor@example.com', orderNumber: 'WN-Q4M1ZT' }, // someone else's order
    ];
    for (const body of attempts) {
      const res = await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send(body).expect(404);
      expect(res.body).toEqual(NOT_FOUND);
      expect(cookiesOf(res).some((c) => c.startsWith('rs_session='))).toBe(false);
    }
  });

  it('rejects malformed input with 400 before looking anything up', async () => {
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: 'not-an-email', orderNumber: 'WN-7K3P9Q' }).expect(400);
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: 'ada.okafor@example.com', orderNumber: "' OR 1=1 --" }).expect(400);
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: 'ada.okafor@example.com', orderNumber: 'WN-7K3P9Q', isAdmin: true }).expect(400);
  });

  it('refuses a state-changing request without the anti-CSRF header', async () => {
    const res = await request(app.getHttpServer()).post(LOGIN).set(asVisitor()).send({ email: 'ada.okafor@example.com', orderNumber: 'WN-7K3P9Q' }).expect(403);
    expect(cookiesOf(res)).toEqual([]);
    await request(app.getHttpServer()).post(LOGIN).set(asVisitor()).set('X-Requested-With', 'XMLHttpRequest').send({ email: 'ada.okafor@example.com', orderNumber: 'WN-7K3P9Q' }).expect(403);
  });

  it('tells a signed-in customer who they are, and nobody else', async () => {
    const cookie = await signIn(app, 'grace.lee@example.com', 'WN-4GK1VS');
    await request(app.getHttpServer()).get(LOGIN).set('Cookie', cookie).expect(200, { firstName: 'Grace' });
    await request(app.getHttpServer()).get(LOGIN).expect(401);
    const [name, value] = cookie.split('=');
    await request(app.getHttpServer()).get(LOGIN).set('Cookie', `${name}=${value.slice(0, -2)}xx`).expect(401);
  });

  it('signs out by clearing the cookie', async () => {
    const res = await request(app.getHttpServer()).delete(LOGIN).set(CSRF).expect(204);
    const cleared = cookiesOf(res).find((c) => c.startsWith('rs_session='))!;
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cleared).toMatch(/Path=\/api/);
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
      await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '203.0.113.7').send({ email: `guess${i}@example.com`, orderNumber: 'WN-7K3P9Q' }).expect(404);
    }
    const res = await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '203.0.113.7').send({ email: 'ada.okafor@example.com', orderNumber: 'WN-7K3P9Q' }).expect(429);
    expect(res.body.message).toBe('Too many requests. Please wait a moment and try again.');
    // A different IP is unaffected.
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '203.0.113.8').send({ email: 'ada.okafor@example.com', orderNumber: 'WN-7K3P9Q' }).expect(200);
  });

  it('locks an email after 5 failed attempts from any IPs; even the right order number is then refused', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', `198.51.100.${i}`).send({ email: 'ada.okafor@example.com', orderNumber: `WN-GUES0${i}` }).expect(404);
    }
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '198.51.100.99').send({ email: 'ADA.okafor@example.com', orderNumber: 'WN-7K3P9Q' }).expect(429);
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '198.51.100.99').send({ email: 'ben.carter@example.com', orderNumber: 'WN-Q4M1ZT' }).expect(200);
  });

  it('never locks out a customer for signing in successfully many times', async () => {
    for (let i = 0; i < 8; i++) {
      await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', `198.51.101.${i}`).send({ email: 'ada.okafor@example.com', orderNumber: 'WN-7K3P9Q' }).expect(200);
    }
  });
});
