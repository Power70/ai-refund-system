import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { PolicyRegistryModule } from '../policy/registry/policy-registry.module.js';
import { AdminOverviewController } from './admin-overview.controller.js';
import { AdminRefundRequestsController } from './admin-refund-requests.controller.js';

@Module({
  imports: [AdminAuthModule, PolicyRegistryModule],
  controllers: [AdminRefundRequestsController, AdminOverviewController],
})
export class AdminModule {}
