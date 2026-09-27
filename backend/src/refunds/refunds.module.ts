import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module.js';
import { RefundSubmissionService } from './refund-submission.service.js';
import { CustomerRefundRequestsController } from './refunds.controller.js';
import { RequestSweeperService, SWEEPER_INTERVAL_MS } from './request-sweeper.js';

@Module({
  imports: [CustomerAuthModule],
  controllers: [CustomerRefundRequestsController],
  providers: [
    RefundSubmissionService,
    {
      provide: SWEEPER_INTERVAL_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => config.get('SWEEPER_INTERVAL_MS', { infer: true }),
    },
    RequestSweeperService,
  ],
})
export class RefundsModule {}
