import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { authProviders } from './auth.providers.js';
import { AuthService } from './auth.service.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { CustomerAuthGuard } from './guards/customer-auth.guard.js';

/** Customer sessions and admin token authentication. Import it to use either guard. */
@Module({
  controllers: [AuthController],
  providers: [...authProviders, AuthService, CustomerAuthGuard, AdminAuthGuard],
  exports: [AuthService, CustomerAuthGuard, AdminAuthGuard],
})
export class AuthModule {}
