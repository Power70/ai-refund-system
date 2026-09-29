import { HttpException, HttpStatus, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, SIGN_IN_FAILED, TOO_MANY_ATTEMPTS } from '../auth.service.js';
import { ADMIN_COOKIE_PATH, ADMIN_SESSION_COOKIE, sessionCookieOptions } from '../session-token.js';

/**
 * Support dashboard access: the httpOnly session cookie the dashboard receives for the admin password,
 * or `Authorization: Bearer <ADMIN_PASSWORD>` for API clients. Wrong passwords lock the IP for a while.
 * Cookie requests are also covered by SameSite=Strict and the global X-Requested-With check.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { cookies?: Record<string, string> }>();
    const res = http.getResponse<Response>();

    const authorization = req.get('authorization');
    if (!authorization) {
      const token = req.cookies?.[ADMIN_SESSION_COOKIE];
      const session = await this.auth.session('ADMIN', token);
      if (!session) throw new UnauthorizedException('Please sign in to the support dashboard.');
      if (session.renewedUntil) res.cookie(ADMIN_SESSION_COOKIE, token, sessionCookieOptions(req.secure, ADMIN_COOKIE_PATH, session.renewedUntil));
      return true;
    }

    const result = await this.auth.checkAdmin(authorization, String(req.ip));
    if (result === 'ok') return true;
    if (result === 'locked') throw new HttpException(TOO_MANY_ATTEMPTS, HttpStatus.TOO_MANY_REQUESTS);
    res.setHeader('WWW-Authenticate', 'Bearer');
    throw new UnauthorizedException(SIGN_IN_FAILED);
  }
}
