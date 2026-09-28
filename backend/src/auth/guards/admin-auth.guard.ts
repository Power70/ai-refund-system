import { HttpException, HttpStatus, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, TOO_MANY_ATTEMPTS } from '../auth.service.js';

/**
 * Support dashboard access via `Authorization: Bearer <ADMIN_TOKEN>`. A header rather than a cookie,
 * so browsers never attach it automatically (no CSRF exposure). Demo-grade; production would use SSO/RBAC.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const result = this.auth.checkAdmin(req.get('authorization'), String(req.ip));
    if (result === 'ok') return true;
    if (result === 'locked') throw new HttpException(TOO_MANY_ATTEMPTS, HttpStatus.TOO_MANY_REQUESTS);
    http.getResponse<Response>().setHeader('WWW-Authenticate', 'Bearer');
    throw new UnauthorizedException('A valid admin token is required.');
  }
}
