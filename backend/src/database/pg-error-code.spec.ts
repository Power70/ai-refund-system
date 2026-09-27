import { pgErrorCode } from './pg-error-code.js';

describe('pgErrorCode', () => {
  it('reads a direct node-postgres error', () => {
    expect(pgErrorCode({ code: '23505' })).toBe('23505');
  });
  it('reads an error wrapped by Drizzle', () => {
    expect(pgErrorCode(new Error('query failed', { cause: { code: '23514' } }))).toBe('23514');
  });
  it('ignores non-SQLSTATE codes and non-errors', () => {
    expect(pgErrorCode({ code: 'ECONNREFUSED' })).toBeUndefined();
    expect(pgErrorCode(undefined)).toBeUndefined();
  });
});
