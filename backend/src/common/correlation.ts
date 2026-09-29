import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';
/** Accepted incoming IDs: letters, digits, `-`, `_`, `.`; anything else is replaced. */
const VALID_ID = /^[\w.-]{8,64}$/;

const storage = new AsyncLocalStorage<string>();

/** The ID of the HTTP request (or background pass) this code runs for; null outside one. */
export function correlationId(): string | null {
  return storage.getStore() ?? null;
}

/** Runs `fn` with `id` as the correlation ID, including async work it starts. */
export function runWithCorrelation<T>(id: string, fn: () => T): T {
  return storage.run(id, fn);
}

/**
 * Tags each request with an ID: the proxy's `X-Request-Id` when well formed, otherwise a new one.
 * The ID is echoed in the response and follows the request into audit records and log lines,
 * including work that finishes after the response (a decision past the submit wait).
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(REQUEST_ID_HEADER);
  const id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  runWithCorrelation(id, next);
}
