import { HttpException, HttpStatus, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AuthService } from '../auth.service.js';
import { AdminAuthGuard } from './admin-auth.guard.js';

function setup(result: 'ok' | 'invalid' | 'locked') {
  const auth = { checkAdmin: vi.fn().mockReturnValue(result) };
  const res = { setHeader: vi.fn() };
  const req = { ip: '10.0.0.1', get: (name: string) => (name === 'authorization' ? 'Bearer x' : undefined) };
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
});
