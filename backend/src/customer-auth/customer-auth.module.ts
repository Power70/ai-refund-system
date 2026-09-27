import { Module } from '@nestjs/common';
import { CustomerAuthGuard } from './customer-auth.guard.js';
import { CustomerSessionController } from './customer-session.controller.js';
import { CustomerSessionService } from './customer-session.service.js';
import { FailedLoginLimiter } from './failed-login-limiter.js';
import { sessionSecretProvider } from './session-secret.provider.js';

@Module({
  controllers: [CustomerSessionController],
  providers: [sessionSecretProvider, CustomerSessionService, CustomerAuthGuard, FailedLoginLimiter],
  exports: [sessionSecretProvider, CustomerAuthGuard],
})
export class CustomerAuthModule {}
