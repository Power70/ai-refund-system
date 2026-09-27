import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/validate-env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

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
    HealthModule,
  ],
})
export class AppModule {}
