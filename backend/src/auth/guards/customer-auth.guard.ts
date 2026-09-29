import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth.service.js';
import type { AuthenticatedRequest } from '../decorators/current-customer.decorator.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../session-token.js';

/** Admits requests with a valid session cookie, exposes the customer id and slides the session forward. */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<Partial<AuthenticatedRequest> & Pick<Request, 'secure'> & { cookies?: Record<string, string> }>();
    const session = this.auth.session('customer', req.cookies?.[SESSION_COOKIE]);
    if (!session) throw new UnauthorizedException('Please verify your email and order number to continue.');
    req.customerId = session.sub;
    if (session.renewed) http.getResponse<Response>().cookie(SESSION_COOKIE, session.renewed.token, sessionCookieOptions(Boolean(req.secure), undefined, session.renewed.expiresAt));
    return true;
  }
}
