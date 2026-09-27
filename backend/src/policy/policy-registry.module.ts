import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import type { Env } from '../config/env.js';
import { POLICY_FILE_PATH, PolicyRegistryService } from './policy-registry.js';

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
