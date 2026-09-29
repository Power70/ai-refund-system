import { Module } from '@nestjs/common';
import { AdminSessionController, AuthController } from './auth.controller.js';
import { authProviders } from './auth.providers.js';
import { AuthService } from './auth.service.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { CustomerAuthGuard } from './guards/customer-auth.guard.js';
import { SessionsService } from './sessions.service.js';

/** Customer and admin sessions, and admin token authentication. Import it to use either guard. */
@Module({
  controllers: [AuthController, AdminSessionController],
  providers: [...authProviders, SessionsService, AuthService, CustomerAuthGuard, AdminAuthGuard],
  exports: [AuthService, SessionsService, CustomerAuthGuard, AdminAuthGuard],
})
export class AuthModule {}
