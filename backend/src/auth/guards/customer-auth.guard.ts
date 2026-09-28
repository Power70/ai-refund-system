import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { AuthService } from '../auth.service.js';
import type { AuthenticatedRequest } from '../decorators/current-customer.decorator.js';
import { SESSION_COOKIE } from '../session-token.js';

/** Admits requests with a valid session cookie and exposes the customer id on the request. */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Partial<AuthenticatedRequest> & { cookies?: Record<string, string> }>();
    const customerId = this.auth.verifySession(req.cookies?.[SESSION_COOKIE]);
    if (!customerId) throw new UnauthorizedException('Please verify your email and order number to continue.');
    req.customerId = customerId;
    return true;
  }
}
