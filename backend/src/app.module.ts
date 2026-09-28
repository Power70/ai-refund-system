import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module.js';
import { AiModule } from './ai/ai.module.js';
import { AuthModule } from './auth/auth.module.js';
import { throttlerOptions } from './common/rate-limit.js';
import { validateEnv } from './config/env.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PolicyModule } from './policy/policy.module.js';
import { RefundsModule } from './refunds/refunds.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Configuration comes from the process environment (docker-compose),
      // never from a file baked into the image.
      ignoreEnvFile: true,
      validate: validateEnv,
      // Read only validated values. Compose passes unset variables as empty strings, which
      // validation turns into undefined; without this, ConfigService falls back to those raw strings.
      skipProcessEnv: true,
    }),
    DatabaseModule,
    AiModule,
    ThrottlerModule.forRoot(throttlerOptions),
    AuthModule,
    PolicyModule,
    HealthModule,
    OrdersModule,
    RefundsModule,
    ConversationsModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
