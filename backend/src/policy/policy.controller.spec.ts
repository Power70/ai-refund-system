import { PolicyController } from './policy.controller.js';
import { parsePolicy } from './policy-schema.js';
import type { PolicyService } from './policy.service.js';
import { readFileSync } from 'node:fs';

const document = parsePolicy(readFileSync(new URL('../../../policy/refund-policy.yaml', import.meta.url), 'utf8'));

describe('PolicyController', () => {
  it('returns the active policy with its rendered Markdown', async () => {
    const policies = {
      activePolicy: vi.fn().mockResolvedValue({ id: 'v1', version: document.version, contentHash: 'abc', effectiveFrom: new Date('2026-09-01T00:00:00Z'), document }),
    };
    const result = await new PolicyController(policies as unknown as PolicyService).active();
    expect(result).toMatchObject({ version: document.version, effectiveFrom: '2026-09-01T00:00:00.000Z', contentHash: 'abc', document });
    expect(result.markdown).toContain(document.version);
  });
});
