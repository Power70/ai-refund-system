import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth.service.js';
import type { AuthenticatedRequest } from '../decorators/current-customer.decorator.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../session-token.js';

/** Admits requests with a live session cookie, exposes the customer id and slides the session forward. */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Partial<AuthenticatedRequest> & Pick<Request, 'secure'> & { cookies?: Record<string, string> }>();
    const token = req.cookies?.[SESSION_COOKIE];
    const session = await this.auth.session('CUSTOMER', token);
    if (!session?.customerId) throw new UnauthorizedException('Please sign in to continue.');
    req.customerId = session.customerId;
    if (session.renewedUntil) http.getResponse<Response>().cookie(SESSION_COOKIE, token, sessionCookieOptions(Boolean(req.secure), undefined, session.renewedUntil));
    return true;
  }
}
