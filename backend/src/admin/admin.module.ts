import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HealthModule } from '../health/health.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AdminCustomersService } from './customers.service.js';
import { ResolutionService } from './resolution.service.js';

/** The support dashboard API: queue, case briefs, resolutions, customers, metrics and detailed health. */
@Module({
  imports: [AuthModule, HealthModule, OrdersModule],
  controllers: [AdminController],
  providers: [AdminService, ResolutionService, AdminCustomersService],
})
export class AdminModule {}
