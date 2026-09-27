import { Module } from '@nestjs/common';
import { CustomerAuthGuard, FailedLoginLimiter, sessionSecretProvider } from './customer-auth.js';
import { CustomerSessionController } from './customer-session.controller.js';
import { CustomerSessionService } from './customer-session.service.js';

@Module({
  controllers: [CustomerSessionController],
  providers: [sessionSecretProvider, CustomerSessionService, CustomerAuthGuard, FailedLoginLimiter],
  exports: [sessionSecretProvider, CustomerAuthGuard],
})
export class CustomerAuthModule {}
