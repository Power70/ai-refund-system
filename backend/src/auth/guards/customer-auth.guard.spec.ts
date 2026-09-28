import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AuthService } from '../auth.service.js';
import { CustomerAuthGuard } from './customer-auth.guard.js';

const contextFor = (req: object) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

describe('CustomerAuthGuard', () => {
  it('admits a valid session and exposes the customer id', () => {
    const auth = { verifySession: vi.fn().mockReturnValue('customer-1') };
    const req: { cookies: Record<string, string>; customerId?: string } = { cookies: { rs_session: 'tok' } };
    expect(new CustomerAuthGuard(auth as unknown as AuthService).canActivate(contextFor(req))).toBe(true);
    expect(auth.verifySession).toHaveBeenCalledWith('tok');
    expect(req.customerId).toBe('customer-1');
  });

  it('rejects a missing or invalid session', () => {
    const auth = { verifySession: vi.fn().mockReturnValue(null) };
    const guard = new CustomerAuthGuard(auth as unknown as AuthService);
    expect(() => guard.canActivate(contextFor({}))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextFor({ cookies: { rs_session: 'bad' } }))).toThrow(UnauthorizedException);
  });
});
