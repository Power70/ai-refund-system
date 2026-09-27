import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module.js';
import { CustomerRefundRequestsController } from './submission/customer-refund-requests.controller.js';
import { RefundSubmissionService } from './submission/refund-submission.service.js';

@Module({
  imports: [CustomerAuthModule],
  controllers: [CustomerRefundRequestsController],
  providers: [RefundSubmissionService],
})
export class RefundsModule {}
