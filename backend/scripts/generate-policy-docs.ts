/**
 * Regenerates policy/refund-policy.md from policy/refund-policy.yaml.
 * Usage (from backend/): npm run policy:docs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parsePolicy } from '../src/policy/parse-policy.js';
import { renderPolicyMarkdown } from '../src/policy/render-policy-markdown.js';

const yamlPath = new URL('../../policy/refund-policy.yaml', import.meta.url);
const mdPath = new URL('../../policy/refund-policy.md', import.meta.url);

const policy = parsePolicy(readFileSync(yamlPath, 'utf8'));
writeFileSync(mdPath, renderPolicyMarkdown(policy), 'utf8');
console.log(`Wrote policy/refund-policy.md (version ${policy.version})`);
