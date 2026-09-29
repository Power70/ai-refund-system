import { HttpStatus, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AuthService } from '../auth.service.js';
import { AdminAuthGuard } from './admin-auth.guard.js';

function setup(result: 'ok' | 'invalid' | 'locked', options: { header?: string; cookie?: string; session?: unknown } = { header: 'Bearer x' }) {
  const auth = { checkAdmin: vi.fn().mockResolvedValue(result), session: vi.fn().mockResolvedValue(options.session ?? null) };
  const res = { setHeader: vi.fn(), cookie: vi.fn() };
  const req = { ip: '10.0.0.1', secure: false, cookies: options.cookie ? { rs_admin: options.cookie } : {}, get: (name: string) => (name === 'authorization' ? options.header : undefined) };
  const context = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ExecutionContext;
  return { guard: new AdminAuthGuard(auth as unknown as AuthService), auth, res, context };
}

describe('AdminAuthGuard', () => {
  it('admits the right bearer password, checked per client IP', async () => {
    const { guard, auth, context } = setup('ok');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.checkAdmin).toHaveBeenCalledWith('Bearer x', '10.0.0.1');
  });

  it('answers a wrong password with 401 "Invalid credentials." and a Bearer challenge', async () => {
    const { guard, res, context } = setup('invalid');
    await expect(guard.canActivate(context)).rejects.toThrow(new UnauthorizedException('Invalid credentials.'));
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
  });

  it('answers a locked IP with 429', async () => {
    const { guard, context } = setup('locked');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('admits a live session cookie without a password check, and extends it when it slides', async () => {
    const renewedUntil = new Date('2026-09-29T12:30:00Z');
    const { guard, auth, res, context } = setup('invalid', { cookie: 'tok', session: { customerId: null, renewedUntil } });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.session).toHaveBeenCalledWith('ADMIN', 'tok');
    expect(auth.checkAdmin).not.toHaveBeenCalled();
    expect(res.cookie).toHaveBeenCalledWith('rs_admin', 'tok', expect.objectContaining({ httpOnly: true, path: '/api/v1/admin', expires: renewedUntil }));
  });

  it('rejects a missing or unknown session cookie', async () => {
    const { guard, auth, context } = setup('invalid', { cookie: 'forged' });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(auth.checkAdmin).not.toHaveBeenCalled();
  });
});
