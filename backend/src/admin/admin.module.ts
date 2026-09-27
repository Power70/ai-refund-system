import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminRefundRequestsController } from './admin-refund-requests.controller.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminRefundRequestsController],
})
export class AdminModule {}
