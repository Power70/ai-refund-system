import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module.js';
import { CustomerRefundRequestsController } from './submission/customer-refund-requests.controller.js';
import { RefundSubmissionService } from './submission/refund-submission.service.js';
import { RequestSweeperService } from './sweeper/request-sweeper.service.js';
import { SWEEPER_INTERVAL_MS } from './sweeper/sweeper-interval.token.js';

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
