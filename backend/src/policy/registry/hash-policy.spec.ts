import { readFileSync } from 'node:fs';
import { parsePolicy } from '../parse-policy.js';
import { hashPolicy } from './hash-policy.js';

const yaml = readFileSync(new URL('../../../../policy/refund-policy.yaml', import.meta.url), 'utf8');

describe('hashPolicy', () => {
  const base = hashPolicy(parsePolicy(yaml));

  it('is a SHA-256 hex digest', () => {
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores comments and formatting', () => {
    const reformatted = yaml
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .map((line) => line.replace(/\s+#.*$/, ''))
      .join('\n\n');
    expect(hashPolicy(parsePolicy(reformatted))).toBe(base);
  });

  it('ignores the version label (it names the rules, it is not one of them)', () => {
    expect(hashPolicy({ ...parsePolicy(yaml), version: 'renamed' })).toBe(base);
  });

  it('changes when any rule changes', () => {
    expect(hashPolicy(parsePolicy(yaml.replace('value: 50000', 'value: 30000')))).not.toBe(base);
  });
});
