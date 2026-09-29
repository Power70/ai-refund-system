import { type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SlidingFailureWindow } from '../common/rate-limit.js';
import type { Env } from '../config/env.js';
import { hashPassword } from './passwords.js';

/** The admin password as a scrypt hash: the plain value is read once at startup and not kept. */
export const ADMIN_PASSWORD_HASH = Symbol('ADMIN_PASSWORD_HASH');
/** Failed customer sign-ins per email: 5 per 15 minutes. */
export const LOGIN_FAILURES = Symbol('LOGIN_FAILURES');
/** Wrong admin passwords per IP: 10 per 15 minutes. */
export const ADMIN_FAILURES = Symbol('ADMIN_FAILURES');

const FIFTEEN_MINUTES = 15 * 60_000;

export const authProviders: Provider[] = [
  {
    provide: ADMIN_PASSWORD_HASH,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>): Promise<string> => hashPassword(config.get('ADMIN_PASSWORD', { infer: true })),
  },
  { provide: LOGIN_FAILURES, useFactory: () => new SlidingFailureWindow(5, FIFTEEN_MINUTES) },
  { provide: ADMIN_FAILURES, useFactory: () => new SlidingFailureWindow(10, FIFTEEN_MINUTES) },
];
