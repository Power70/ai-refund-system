import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module.js';
import { AiModule } from './ai/ai.module.js';
import { throttlerOptions } from './common/rate-limit.js';
import { validateEnv } from './config/env.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { CustomerAuthModule } from './customer-auth/customer-auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PolicyRegistryModule } from './policy/policy-registry.module.js';
import { RefundsModule } from './refunds/refunds.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Configuration comes from the process environment (docker-compose),
      // never from a file baked into the image.
      ignoreEnvFile: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    AiModule,
    ThrottlerModule.forRoot(throttlerOptions),
    HealthModule,
    PolicyRegistryModule,
    CustomerAuthModule,
    OrdersModule,
    RefundsModule,
    ConversationsModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
