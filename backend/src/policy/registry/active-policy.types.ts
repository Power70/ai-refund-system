import type { PolicyDocument } from '../policy.schema.js';

/** A registered policy version: what decisions reference and evaluate against. */
export interface RegisteredPolicy {
  id: string;
  version: string;
  contentHash: string;
  effectiveFrom: Date;
  document: PolicyDocument;
}
