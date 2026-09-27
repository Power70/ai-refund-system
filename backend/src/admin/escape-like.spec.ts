import { escapeLike } from './escape-like.js';

describe('escapeLike', () => {
  it('escapes %, _ and backslash', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });
  it('leaves normal text alone', () => {
    expect(escapeLike('ada.okafor@example.com')).toBe('ada.okafor@example.com');
  });
});
