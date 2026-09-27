import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { throttlerOptions } from './common/rate-limit/throttler-options.js';
import { validateEnv } from './config/validate-env.js';
import { CustomerAuthModule } from './customer-auth/customer-auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PolicyRegistryModule } from './policy/registry/policy-registry.module.js';

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
    ThrottlerModule.forRoot(throttlerOptions),
    HealthModule,
    PolicyRegistryModule,
    CustomerAuthModule,
    OrdersModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
