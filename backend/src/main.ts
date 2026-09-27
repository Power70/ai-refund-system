import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './common/configure-app.js';
import { setupSwagger } from './common/setup-swagger.js';
import type { Env } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  // Body parsing is registered explicitly in configureApp with a size limit.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  setupSwagger(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

await bootstrap();
