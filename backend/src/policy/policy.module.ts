import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import { AuthModule } from '../auth/auth.module.js';
import type { Env } from '../config/env.js';
import { PolicyController } from './policy.controller.js';
import { POLICY_FILE_PATH, PolicyService } from './policy.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PolicyController],
  providers: [
    {
      provide: POLICY_FILE_PATH,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => resolve(config.get('POLICY_FILE', { infer: true })),
    },
    PolicyService,
  ],
  exports: [PolicyService],
})
export class PolicyModule {}
