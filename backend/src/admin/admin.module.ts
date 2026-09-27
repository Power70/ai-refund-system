import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { PolicyRegistryModule } from '../policy/policy-registry.module.js';
import { AdminOverviewController, AdminRefundRequestsController } from './admin.controller.js';

@Module({
  imports: [AdminAuthModule, PolicyRegistryModule],
  controllers: [AdminRefundRequestsController, AdminOverviewController],
})
export class AdminModule {}
