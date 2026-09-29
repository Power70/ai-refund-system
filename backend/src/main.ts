import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp, CorrelatedLogger, setupSwagger } from './common/http.js';
import type { Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  // Body parsing is registered explicitly in configureApp with a size limit.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: new CorrelatedLogger() });
  configureApp(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // API docs describe every route; production serves them only when API_DOCS=true.
  if (config.get('API_DOCS', { infer: true }) ?? config.get('NODE_ENV', { infer: true }) !== 'production') setupSwagger(app);
  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

await bootstrap();
