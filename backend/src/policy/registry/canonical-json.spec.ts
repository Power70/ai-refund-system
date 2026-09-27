import { canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('ignores key order at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ y: 1, x: 2 }] } })).toBe(canonicalJson({ a: { c: [{ x: 2, y: 1 }], d: 2 }, b: 1 }));
  });
  it('keeps array order (rule order matters)', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});
