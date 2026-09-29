import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { SlidingFailureWindow } from '../common/rate-limit.js';
import type { Env } from '../config/env.js';

export const SESSION_SECRET = Symbol('SESSION_SECRET');
export const ADMIN_TOKEN = Symbol('ADMIN_TOKEN');
/** Failed customer sign-ins per email: 5 per 15 minutes. */
export const LOGIN_FAILURES = Symbol('LOGIN_FAILURES');
/** Wrong admin tokens per IP: 10 per 15 minutes. */
export const ADMIN_FAILURES = Symbol('ADMIN_FAILURES');

export const DEMO_ADMIN_TOKEN = 'admin-demo-token';
/** docker-compose's default, so demo sessions survive an API restart. */
export const DEMO_SESSION_SECRET = 'demo-session-secret-change-me-in-production';
const FIFTEEN_MINUTES = 15 * 60_000;
const logger = new Logger('Auth');

export const authProviders: Provider[] = [
  {
    provide: SESSION_SECRET,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>): string => {
      const configured = config.get('SESSION_SECRET', { infer: true });
      if (configured === DEMO_SESSION_SECRET) logger.warn('SESSION_SECRET is the public demo value. Set your own for anything beyond a local demo.');
      if (configured) return configured;
      logger.warn('SESSION_SECRET not set: using a random secret. Customer sessions end when the API restarts.');
      return randomBytes(32).toString('base64url');
    },
  },
  {
    provide: ADMIN_TOKEN,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>): string => {
      const token = config.get('ADMIN_TOKEN', { infer: true });
      if (token === DEMO_ADMIN_TOKEN) {
        logger.warn(`ADMIN_TOKEN not set: the dashboard accepts the public demo token "${DEMO_ADMIN_TOKEN}". Set ADMIN_TOKEN for anything beyond a local demo.`);
      }
      return token;
    },
  },
  { provide: LOGIN_FAILURES, useFactory: () => new SlidingFailureWindow(5, FIFTEEN_MINUTES) },
  { provide: ADMIN_FAILURES, useFactory: () => new SlidingFailureWindow(10, FIFTEEN_MINUTES) },
];
