import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './authenticated-request.types.js';
import { SESSION_COOKIE } from './session-cookie.js';
import { SESSION_SECRET } from './session-secret.provider.js';
import { verifySessionToken } from './session-token.js';

/** Admits only requests carrying a valid, unexpired session cookie; exposes the customer id. */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(@Inject(SESSION_SECRET) private readonly secret: string) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & Partial<AuthenticatedRequest>>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const session = token ? verifySessionToken(token, this.secret, new Date()) : null;
    if (!session) throw new UnauthorizedException('Please verify your email and order number to continue.');
    req.customerId = session.sub;
    return true;
  }
}
