/**
 * Regenerates policy/refund-policy.md from policy/refund-policy.yaml.
 * Usage (from backend/): npm run policy:docs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { renderPolicyMarkdown } from '../src/policy/policy-docs.js';
import { parsePolicy } from '../src/policy/policy-schema.js';

const yamlPath = new URL('../../policy/refund-policy.yaml', import.meta.url);
const mdPath = new URL('../../policy/refund-policy.md', import.meta.url);

const policy = parsePolicy(readFileSync(yamlPath, 'utf8'));
writeFileSync(mdPath, renderPolicyMarkdown(policy), 'utf8');
console.log(`Wrote policy/refund-policy.md (version ${policy.version})`);
