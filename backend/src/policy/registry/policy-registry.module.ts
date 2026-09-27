import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { POLICY_FILE_PATH } from './policy-file-path.token.js';
import { PolicyRegistryService } from './policy-registry.service.js';

@Module({
  providers: [
    {
      provide: POLICY_FILE_PATH,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => resolve(config.get('POLICY_FILE', { infer: true })),
    },
    PolicyRegistryService,
  ],
  exports: [PolicyRegistryService],
})
export class PolicyRegistryModule {}
