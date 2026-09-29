import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AuthService } from '../auth.service.js';
import type { VerifiedSession } from '../sessions.service.js';
import { CustomerAuthGuard } from './customer-auth.guard.js';

function setup(session: VerifiedSession | null, cookies?: Record<string, string>) {
  const auth = { session: vi.fn().mockResolvedValue(session) };
  const req: { cookies?: Record<string, string>; customerId?: string; secure: boolean } = { cookies, secure: false };
  const res = { cookie: vi.fn() };
  const context = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ExecutionContext;
  return { guard: new CustomerAuthGuard(auth as unknown as AuthService), auth, req, res, context };
}

describe('CustomerAuthGuard', () => {
  it('admits a live session and exposes the customer id', async () => {
    const { guard, auth, req, res, context } = setup({ customerId: 'customer-1', renewedUntil: null }, { rs_session: 'tok' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.session).toHaveBeenCalledWith('CUSTOMER', 'tok');
    expect(req.customerId).toBe('customer-1');
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('extends the cookie when the session slides forward', async () => {
    const renewedUntil = new Date('2026-09-29T12:30:00Z');
    const { guard, res, context } = setup({ customerId: 'customer-1', renewedUntil }, { rs_session: 'tok' });
    await guard.canActivate(context);
    expect(res.cookie).toHaveBeenCalledWith('rs_session', 'tok', expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/api', expires: renewedUntil }));
  });

  it('rejects a missing, unknown or admin session', async () => {
    const none = setup(null);
    await expect(none.guard.canActivate(none.context)).rejects.toThrow(UnauthorizedException);
    const bad = setup(null, { rs_session: 'bad' });
    await expect(bad.guard.canActivate(bad.context)).rejects.toThrow(UnauthorizedException);
    const admin = setup({ customerId: null, renewedUntil: null }, { rs_session: 'tok' });
    await expect(admin.guard.canActivate(admin.context)).rejects.toThrow(UnauthorizedException);
  });
});
