import { readFileSync } from 'node:fs';
import { parsePolicy } from './parse-policy.js';
import { renderPolicyMarkdown } from './render-policy-markdown.js';

const read = (file: string) => readFileSync(new URL(`../../../policy/${file}`, import.meta.url), 'utf8');

describe('policy/refund-policy.md', () => {
  it('matches what refund-policy.yaml generates (run `npm run policy:docs` after editing the YAML)', () => {
    const expected = renderPolicyMarkdown(parsePolicy(read('refund-policy.yaml')));
    // Normalise line endings so a Windows checkout without .gitattributes still compares fairly.
    expect(read('refund-policy.md').replaceAll('\r\n', '\n')).toBe(expected);
  });
});
