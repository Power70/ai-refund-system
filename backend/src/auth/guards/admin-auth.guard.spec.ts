import { HttpException, HttpStatus, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AuthService } from '../auth.service.js';
import { AdminAuthGuard } from './admin-auth.guard.js';

function setup(result: 'ok' | 'invalid' | 'locked', options: { header?: string; cookie?: string; session?: unknown } = { header: 'Bearer x' }) {
  const auth = { checkAdmin: vi.fn().mockReturnValue(result), session: vi.fn().mockReturnValue(options.session ?? null) };
  const res = { setHeader: vi.fn(), cookie: vi.fn() };
  const req = { ip: '10.0.0.1', secure: false, cookies: options.cookie ? { rs_admin: options.cookie } : {}, get: (name: string) => (name === 'authorization' ? options.header : undefined) };
  const context = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ExecutionContext;
  return { guard: new AdminAuthGuard(auth as unknown as AuthService), auth, res, context };
}

describe('AdminAuthGuard', () => {
  it('admits a valid token, checked per client IP', () => {
    const { guard, auth, context } = setup('ok');
    expect(guard.canActivate(context)).toBe(true);
    expect(auth.checkAdmin).toHaveBeenCalledWith('Bearer x', '10.0.0.1');
  });

  it('answers a wrong token with 401 and a Bearer challenge', () => {
    const { guard, res, context } = setup('invalid');
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
  });

  it('answers a locked IP with 429', () => {
    const { guard, context } = setup('locked');
    try {
      guard.canActivate(context);
      expect.unreachable();
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('admits a valid session cookie without counting a failure, and slides it forward', () => {
    const expiresAt = new Date('2026-09-29T12:30:00Z');
    const { guard, auth, res, context } = setup('invalid', { cookie: 'tok', session: { sub: 'admin', renewed: { token: 'new', expiresAt } } });
    expect(guard.canActivate(context)).toBe(true);
    expect(auth.session).toHaveBeenCalledWith('admin', 'tok');
    expect(auth.checkAdmin).not.toHaveBeenCalled();
    expect(res.cookie).toHaveBeenCalledWith('rs_admin', 'new', expect.objectContaining({ httpOnly: true, path: '/api/v1/admin', expires: expiresAt }));
  });

  it('rejects a missing or invalid session cookie', () => {
    const { guard, auth, context } = setup('invalid', { cookie: 'forged' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(auth.checkAdmin).not.toHaveBeenCalled();
  });
});
