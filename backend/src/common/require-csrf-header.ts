import type { NextFunction, Request, Response } from 'express';

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
