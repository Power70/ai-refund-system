import { generatePublicRequestId } from './generate-public-request-id.js';

describe('generatePublicRequestId', () => {
  it('matches the format the database enforces', () => {
    for (let i = 0; i < 1000; i++) expect(generatePublicRequestId()).toMatch(/^rr_[0-9a-hjkmnp-tv-z]{12}$/);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 10_000 }, generatePublicRequestId));
    expect(ids.size).toBe(10_000);
  });
});
