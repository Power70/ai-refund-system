import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AuthService, VerifiedSession } from '../auth.service.js';
import { CustomerAuthGuard } from './customer-auth.guard.js';

function setup(session: VerifiedSession | null, cookies?: Record<string, string>) {
  const auth = { session: vi.fn().mockReturnValue(session) };
  const req: { cookies?: Record<string, string>; customerId?: string; secure: boolean } = { cookies, secure: false };
  const res = { cookie: vi.fn() };
  const context = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ExecutionContext;
  return { guard: new CustomerAuthGuard(auth as unknown as AuthService), auth, req, res, context };
}

describe('CustomerAuthGuard', () => {
  it('admits a valid session and exposes the customer id', () => {
    const { guard, auth, req, res, context } = setup({ sub: 'customer-1', renewed: null }, { rs_session: 'tok' });
    expect(guard.canActivate(context)).toBe(true);
    expect(auth.session).toHaveBeenCalledWith('customer', 'tok');
    expect(req.customerId).toBe('customer-1');
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('sets the renewed cookie when the session slides forward', () => {
    const expiresAt = new Date('2026-09-29T12:30:00Z');
    const { guard, res, context } = setup({ sub: 'customer-1', renewed: { token: 'new', expiresAt } }, { rs_session: 'tok' });
    guard.canActivate(context);
    expect(res.cookie).toHaveBeenCalledWith('rs_session', 'new', expect.objectContaining({ httpOnly: true, path: '/api', expires: expiresAt }));
  });

  it('rejects a missing or invalid session', () => {
    expect(() => setup(null).guard.canActivate(setup(null).context)).toThrow(UnauthorizedException);
    const bad = setup(null, { rs_session: 'bad' });
    expect(() => bad.guard.canActivate(bad.context)).toThrow(UnauthorizedException);
  });
});
