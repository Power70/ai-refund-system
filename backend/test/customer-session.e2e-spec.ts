import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './create-test-app.js';
import { prepareDemoDatabase, asVisitor, CSRF, signIn, type TestDatabase } from './support/test-app.js';

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
    const res = await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: 'ada.okafor@example.com', password: 'customer' }).expect(200);
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
    const res = await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).set('X-Forwarded-Proto', 'https').send({ email: 'ben.carter@example.com', password: 'customer' }).expect(200);
    expect(cookiesOf(res).find((c) => c.startsWith('rs_session='))).toMatch(/Secure/);
  });

  it('ignores case and surrounding spaces', async () => {
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: '  Ada.Okafor@EXAMPLE.com ', password: 'customer' }).expect(200);
  });

  it('answers "Invalid credentials." whether the email or the password is wrong, and sets no cookie', async () => {
    const attempts = [
      { email: 'ada.okafor@example.com', password: 'wrong-password' }, // wrong password
      { email: 'nobody@example.com', password: 'customer' }, // unknown email
      { email: 'ada.okafor@example.com', password: 'Customer' }, // passwords are case-sensitive
    ];
    for (const body of attempts) {
      const res = await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send(body).expect(401);
      expect(res.body).toEqual(INVALID);
      expect(cookiesOf(res).some((c) => c.startsWith('rs_session='))).toBe(false);
    }
  });

  it('rejects malformed input with 400 before looking anything up', async () => {
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: 'not-an-email', password: 'customer' }).expect(400);
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: 'ada.okafor@example.com' }).expect(400);
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set(asVisitor()).send({ email: 'ada.okafor@example.com', password: 'customer', isAdmin: true }).expect(400);
  });

  it('refuses a state-changing request without the anti-CSRF header', async () => {
    const res = await request(app.getHttpServer()).post(LOGIN).set(asVisitor()).send({ email: 'ada.okafor@example.com', password: 'customer' }).expect(403);
    expect(cookiesOf(res)).toEqual([]);
    await request(app.getHttpServer()).post(LOGIN).set(asVisitor()).set('X-Requested-With', 'XMLHttpRequest').send({ email: 'ada.okafor@example.com', password: 'customer' }).expect(403);
  });

  it('tells a signed-in customer who they are, and nobody else', async () => {
    const cookie = await signIn(app, 'grace.lee@example.com');
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
      await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '203.0.113.7').send({ email: `guess${i}@example.com`, password: 'customer' }).expect(401);
    }
    const res = await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '203.0.113.7').send({ email: 'ada.okafor@example.com', password: 'customer' }).expect(429);
    expect(res.body.message).toBe('Too many requests. Please wait a moment and try again.');
    // A different IP is unaffected.
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '203.0.113.8').send({ email: 'ada.okafor@example.com', password: 'customer' }).expect(200);
  });

  it('locks an email after 5 failed attempts from any IPs; even the right password is then refused', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', `198.51.100.${i}`).send({ email: 'ada.okafor@example.com', password: `guess-${i}` }).expect(401);
    }
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '198.51.100.99').send({ email: 'ADA.okafor@example.com', password: 'customer' }).expect(429);
    await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', '198.51.100.99').send({ email: 'ben.carter@example.com', password: 'customer' }).expect(200);
  });

  it('never locks out a customer for signing in successfully many times', async () => {
    for (let i = 0; i < 8; i++) {
      await request(app.getHttpServer()).post(LOGIN).set(CSRF).set('X-Forwarded-For', `198.51.101.${i}`).send({ email: 'ada.okafor@example.com', password: 'customer' }).expect(200);
    }
  });
});
