import { HttpException, HttpStatus, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, TOO_MANY_ATTEMPTS } from '../auth.service.js';
import { ADMIN_COOKIE_PATH, ADMIN_SESSION_COOKIE, sessionCookieOptions } from '../session-token.js';

/**
 * Support dashboard access: `Authorization: Bearer <ADMIN_PASSWORD>` (API clients), or the httpOnly
 * session cookie the dashboard receives in exchange for the password. Cookie requests are covered by
 * SameSite=Strict and the global X-Requested-With check. Demo-grade; production would use SSO/RBAC.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { cookies?: Record<string, string> }>();
    const res = http.getResponse<Response>();

    const authorization = req.get('authorization');
    if (!authorization) {
      const session = this.auth.session('admin', req.cookies?.[ADMIN_SESSION_COOKIE]);
      if (!session) throw new UnauthorizedException('Please sign in to the support dashboard.');
      if (session.renewed) res.cookie(ADMIN_SESSION_COOKIE, session.renewed.token, sessionCookieOptions(req.secure, ADMIN_COOKIE_PATH, session.renewed.expiresAt));
      return true;
    }

    const result = this.auth.checkAdmin(authorization, String(req.ip));
    if (result === 'ok') return true;
    if (result === 'locked') throw new HttpException(TOO_MANY_ATTEMPTS, HttpStatus.TOO_MANY_REQUESTS);
    res.setHeader('WWW-Authenticate', 'Bearer');
    throw new UnauthorizedException('Invalid credentials.');
  }
}
