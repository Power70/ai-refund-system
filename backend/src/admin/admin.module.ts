import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HealthModule } from '../health/health.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { ResolutionService } from './resolution.service.js';

/** The support dashboard API: queue, case briefs, resolutions, metrics and detailed health. */
@Module({
  imports: [AuthModule, HealthModule],
  controllers: [AdminController],
  providers: [AdminService, ResolutionService],
})
export class AdminModule {}
