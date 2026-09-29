import type { LlmService } from '../ai/llm.service.js';
import type { Database } from '../database/database.providers.js';
import type { HealthService } from '../health/health.service.js';
import { AdminService, escapeLike } from './admin.service.js';

describe('escapeLike', () => {
  it('escapes %, _ and backslash', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });
  it('leaves normal text alone', () => {
    expect(escapeLike('customer+1@example.test')).toBe('customer+1@example.test');
  });
});

class TestAdminService extends AdminService {
  countRequests = vi.fn(async () => ({
    total: 11, last24Hours: 4, processing: 1, approved: 6, denied: 1, escalated: 3, awaitingReview: 2,
    resolvedApproved: 1, resolvedPartiallyApproved: 0, resolvedDenied: 1,
  }));
  countEscalationReasons = vi.fn(async () => [{ reason: 'HIGH_VALUE', count: 2 }]);
}

describe('AdminService.metrics', () => {
  it('combines request counts, resolutions, reasons, stuck requests and AI status', async () => {
    const health = { countStuckRequests: vi.fn(async () => 1) };
    const ai = { status: 'disabled', provider: null, model: null, lastError: null };
    const llm = { report: vi.fn(() => ai) };
    const service = new TestAdminService({} as Database, health as unknown as HealthService, llm as unknown as LlmService);
    const now = new Date('2026-09-27T12:00:00Z');

    await expect(service.metrics(now)).resolves.toEqual({
      generatedAt: '2026-09-27T12:00:00.000Z',
      requests: { total: 11, last24Hours: 4, processing: 1, approved: 6, denied: 1, escalated: 3, awaitingReview: 2 },
      resolutions: { approved: 1, partiallyApproved: 0, denied: 1 },
      topEscalationReasons: [{ reason: 'HIGH_VALUE', count: 2 }],
      stuckProcessingCount: 1,
      ai,
    });
    expect(service.countRequests).toHaveBeenCalledWith(now);
    expect(health.countStuckRequests).toHaveBeenCalledWith(now);
  });
});
