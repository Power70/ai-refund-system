import type { NextFunction, Request, Response } from 'express';
import { correlationId, correlationMiddleware, runWithCorrelation } from './correlation.js';
import { CorrelatedLogger } from './http.js';

function handle(incoming?: string) {
  const req = { get: () => incoming } as unknown as Request;
  const headers: Record<string, string> = {};
  const res = { setHeader: (name: string, value: string) => (headers[name] = value) } as unknown as Response;
  let seen: string | null = null;
  const next: NextFunction = () => {
    seen = correlationId();
  };
  correlationMiddleware(req, res, next);
  return { header: headers['X-Request-Id'], seen };
}

describe('correlationMiddleware', () => {
  it('keeps a well-formed incoming request ID and echoes it', () => {
    expect(handle('0f3c9a61b2d84e7fa1c2d3e4f5a6b7c8')).toEqual({ header: '0f3c9a61b2d84e7fa1c2d3e4f5a6b7c8', seen: '0f3c9a61b2d84e7fa1c2d3e4f5a6b7c8' });
  });

  it.each([undefined, 'short', 'has spaces in it', 'x'.repeat(65), 'newline\ninjection'])('replaces a missing or malformed ID (%j) with a new one', (incoming) => {
    const { header, seen } = handle(incoming);
    expect(header).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen).toBe(header);
  });

  it('has no ID outside a request', () => {
    expect(correlationId()).toBeNull();
  });
});

describe('CorrelatedLogger', () => {
  class Probe extends CorrelatedLogger {
    contextOf(name: string) {
      return this.formatContext(name);
    }
  }

  it('adds the current request ID after the context', () => {
    const logger = new Probe();
    expect(runWithCorrelation('req-12345678', () => logger.contextOf('RefundsService'))).toContain('[req req-12345678]');
    expect(logger.contextOf('RefundsService')).not.toContain('[req');
  });
});
