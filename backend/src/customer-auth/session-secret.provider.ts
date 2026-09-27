import { randomBytes } from 'node:crypto';
import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';

export const SESSION_SECRET = Symbol('SESSION_SECRET');

export const sessionSecretProvider: Provider = {
  provide: SESSION_SECRET,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): string => {
    const configured = config.get('SESSION_SECRET', { infer: true });
    if (configured) return configured;
    new Logger('CustomerSession').warn('SESSION_SECRET not set: using a random secret. Customer sessions end when the API restarts.');
    return randomBytes(32).toString('base64url');
  },
};
