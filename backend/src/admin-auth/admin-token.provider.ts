import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';

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
