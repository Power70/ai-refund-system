import { Logger, type Provider, Injectable, type CanActivate, type ExecutionContext, HttpException, HttpStatus, Inject, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { SlidingFailureWindow } from '../common/rate-limit.js';
import type { Env } from '../config/env.js';

/**
 * Compares two secrets in constant time. Both are hashed first so the comparison takes the
 * same time whatever their lengths (a plain timingSafeEqual would reveal the length).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  return timingSafeEqual(digest(a), digest(b));
}

export const ADMIN_TOKEN = Symbol('ADMIN_TOKEN');
export const DEMO_ADMIN_TOKEN = 'admin-demo-token';

export const adminTokenProvider: Provider = {
  provide: ADMIN_TOKEN,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): string => {
    const token = config.get('ADMIN_TOKEN', { infer: true });
    if (token === DEMO_ADMIN_TOKEN) {
      new Logger('AdminAuth').warn(`ADMIN_TOKEN not set: the dashboard accepts the public demo token "${DEMO_ADMIN_TOKEN}". Set ADMIN_TOKEN for anything beyond a local demo.`);
    }
    return token;
  },
};

/** Locks an IP after 10 wrong admin tokens in 15 minutes (stops token guessing). */
@Injectable()
export class AdminAuthLimiter {
  private readonly window = new SlidingFailureWindow(10, 15 * 60_000);

  isLocked(ip: string): boolean {
    return this.window.isLocked(ip);
  }

  recordFailure(ip: string): void {
    this.window.recordFailure(ip);
  }
}

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
