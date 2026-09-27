import { createHash } from 'node:crypto';
import type { PolicyDocument } from '../policy.schema.js';
import { canonicalJson } from './canonical-json.js';

/**
 * Fingerprint of the rules themselves. The version label is excluded (it names the rules,
 * it isn't one of them), and comments, formatting and key order don't change it.
 */
export function hashPolicy(policy: PolicyDocument): string {
  const { version: _label, ...rules } = policy;
  return createHash('sha256').update(canonicalJson(rules)).digest('hex');
}
