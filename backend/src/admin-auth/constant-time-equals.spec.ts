import { constantTimeEquals } from './constant-time-equals.js';

describe('constantTimeEquals', () => {
  it('matches only identical strings', () => {
    expect(constantTimeEquals('admin-demo-token', 'admin-demo-token')).toBe(true);
    expect(constantTimeEquals('admin-demo-token', 'admin-demo-tokeN')).toBe(false);
    expect(constantTimeEquals('admin-demo-token', 'admin-demo-token ')).toBe(false);
    expect(constantTimeEquals('', 'x')).toBe(false);
  });
});
