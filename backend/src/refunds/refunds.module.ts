import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import type { Env } from '../config/env.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PolicyModule } from '../policy/policy.module.js';
import { CustomerMessagesService } from './customer-messages.service.js';
import { DecisionService } from './decision.service.js';
import { RefundsController } from './refunds.controller.js';
import { RefundsService, SUBMIT_WAIT_MS } from './refunds.service.js';
import { RequestFactsService } from './request-facts.service.js';
import { ReviewSummaryService } from './review-summary.service.js';
import { SWEEPER_INTERVAL_MS, SweeperService } from './sweeper.service.js';

/** Refund submission, automated decisions, recovery of stuck requests and customer messaging. */
@Module({
  imports: [AuthModule, OrdersModule, PolicyModule],
  controllers: [RefundsController],
  providers: [
    RefundsService,
    DecisionService,
    RequestFactsService,
    CustomerMessagesService,
    ReviewSummaryService,
    SweeperService,
    {
      provide: SWEEPER_INTERVAL_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => config.get('SWEEPER_INTERVAL_MS', { infer: true }),
    },
    {
      provide: SUBMIT_WAIT_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => config.get('SUBMIT_WAIT_MS', { infer: true }),
    },
  ],
  exports: [RefundsService, CustomerMessagesService],
})
export class RefundsModule {}
