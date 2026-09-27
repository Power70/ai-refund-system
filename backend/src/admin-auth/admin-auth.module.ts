import { Module } from '@nestjs/common';
import { AdminAuthLimiter, AdminAuthGuard, adminTokenProvider } from './admin-auth.js';

@Module({
  providers: [adminTokenProvider, AdminAuthLimiter, AdminAuthGuard],
  exports: [adminTokenProvider, AdminAuthLimiter, AdminAuthGuard],
})
export class AdminAuthModule {}
