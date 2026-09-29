import { ConsoleLogger, ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { correlationId, correlationMiddleware } from './correlation.js';

export const API_PREFIX = 'api/v1';
export const DOCS_PATH = 'docs';
export const JSON_BODY_LIMIT = '32kb';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'refund-app';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Every state-changing API request must carry `X-Requested-With: refund-app`.
 * A cross-site form or script can't add a custom header without a CORS preflight,
 * and the API allows no cross-origin requests, so a forged request is rejected here.
 * (SameSite=Strict on the session cookie is the second layer.)
 */
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method) || req.get(CSRF_HEADER) === CSRF_HEADER_VALUE) {
    next();
    return;
  }
  res.status(403).json({ statusCode: 403, message: 'Missing or invalid X-Requested-With header.' });
}

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('AI Refund Support API')
    .setDescription('Customer refund requests, AI-assisted intake and the support dashboard.')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(DOCS_PATH, app, document);
}

/**
 * Applies the HTTP hardening shared by the real server and the e2e tests,
 * so tests exercise exactly what runs in production.
 */
export function configureApp(app: NestExpressApplication): void {
  // Behind Nginx on a private Docker network: trust only private proxy hops,
  // so rate limiting (added later) sees the real client IP.
  app.set('trust proxy', 'loopback, uniquelocal');
  app.setGlobalPrefix(API_PREFIX);
  app.use(correlationMiddleware);
  app.use(
    helmet({
      // The demo is served over plain HTTP on localhost. Forcing HTTPS would
      // break the page; in production TLS terminates at a reverse proxy that sets HSTS.
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
      strictTransportSecurity: false,
    }),
  );
  // API responses carry personal data; browsers and proxies must not keep copies.
  app.use((_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.use(cookieParser());
  app.use(requireCsrfHeader);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
}

/** Nest's console logger with the current correlation ID after the context, e.g. `[RefundsService] [req 1f3c…]`. */
export class CorrelatedLogger extends ConsoleLogger {
  protected formatContext(context: string): string {
    const id = correlationId();
    return id ? `${super.formatContext(context)}[req ${id}] ` : super.formatContext(context);
  }
}
