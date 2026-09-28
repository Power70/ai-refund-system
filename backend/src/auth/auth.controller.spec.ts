import { NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';

function setup() {
  const auth = { signIn: vi.fn(), describeCustomer: vi.fn() };
  const res = { cookie: vi.fn(), clearCookie: vi.fn() };
  const controller = new AuthController(auth as unknown as AuthService);
  return { auth, res: res as unknown as Response & typeof res, controller };
}
const req = (secure = false) => ({ secure }) as Request;

describe('AuthController', () => {
  it('signs in and sets an HttpOnly, SameSite=Strict cookie scoped to /api', async () => {
    const { auth, res, controller } = setup();
    auth.signIn.mockResolvedValue({ token: 'tok', firstName: 'Ada', expiresAt: new Date('2026-09-27T12:30:00Z') });

    await expect(controller.signIn({ email: 'ada@example.com', orderNumber: 'WN-7K3P9Q' }, req(true), res)).resolves.toEqual({
      firstName: 'Ada',
      expiresAt: '2026-09-27T12:30:00.000Z',
    });
    expect(res.cookie).toHaveBeenCalledWith('rs_session', 'tok', expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/api', secure: true }));
  });

  it('describes the signed-in customer, or 404s when they no longer exist', async () => {
    const { auth, controller } = setup();
    auth.describeCustomer.mockResolvedValueOnce({ firstName: 'Ada' }).mockResolvedValueOnce(null);
    await expect(controller.current('customer-1')).resolves.toEqual({ firstName: 'Ada' });
    await expect(controller.current('customer-1')).rejects.toThrow(NotFoundException);
  });

  it('signs out by clearing the cookie with the same scope', () => {
    const { res, controller } = setup();
    controller.signOut(req(), res);
    expect(res.clearCookie).toHaveBeenCalledWith('rs_session', expect.objectContaining({ path: '/api', httpOnly: true }));
    expect(res.clearCookie.mock.calls[0][1]).not.toHaveProperty('maxAge');
  });
});
