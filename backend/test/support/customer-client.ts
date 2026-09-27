import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CSRF, signIn } from './sign-in.js';

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
