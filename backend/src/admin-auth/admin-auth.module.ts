import { Module } from '@nestjs/common';
import { AdminAuthLimiter } from './admin-auth-limiter.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { adminTokenProvider } from './admin-token.provider.js';

@Module({
  providers: [adminTokenProvider, AdminAuthLimiter, AdminAuthGuard],
  exports: [adminTokenProvider, AdminAuthLimiter, AdminAuthGuard],
})
export class AdminAuthModule {}
