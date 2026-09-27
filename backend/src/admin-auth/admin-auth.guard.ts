import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminAuthLimiter } from './admin-auth-limiter.js';
import { ADMIN_TOKEN } from './admin-token.provider.js';
import { constantTimeEquals } from './constant-time-equals.js';

/**
 * Support dashboard access: `Authorization: Bearer <ADMIN_TOKEN>`, compared in constant time.
 * A header (not a cookie) so the browser never sends it automatically: no CSRF exposure,
 * and the dashboard keeps it in memory only. Demo-grade auth; production would use SSO/RBAC.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    @Inject(ADMIN_TOKEN) private readonly token: string,
    private readonly limiter: AdminAuthLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const ip = String(req.ip);
    if (this.limiter.isLocked(ip)) {
      throw new HttpException('Too many requests. Please wait a moment and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const header = req.get('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (presented && constantTimeEquals(presented, this.token)) return true;

    this.limiter.recordFailure(ip);
    http.getResponse<Response>().setHeader('WWW-Authenticate', 'Bearer');
    throw new UnauthorizedException('A valid admin token is required.');
  }
}
