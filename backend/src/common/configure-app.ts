import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { API_PREFIX, JSON_BODY_LIMIT } from './http.constants.js';
import { requireCsrfHeader } from './require-csrf-header.js';

/**
 * Applies the HTTP hardening shared by the real server and the e2e tests,
 * so tests exercise exactly what runs in production.
 */
export function configureApp(app: NestExpressApplication): void {
  // Behind Nginx on a private Docker network: trust only private proxy hops,
  // so rate limiting (added later) sees the real client IP.
  app.set('trust proxy', 'loopback, uniquelocal');
  app.setGlobalPrefix(API_PREFIX);
  app.use(
    helmet({
      // The demo is served over plain HTTP on localhost. Forcing HTTPS would
      // break the page; in production TLS terminates at a reverse proxy that sets HSTS.
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
      strictTransportSecurity: false,
    }),
  );
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.use(cookieParser());
  app.use(requireCsrfHeader);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
}
