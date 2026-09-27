import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

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
