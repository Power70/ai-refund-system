import type { Database } from '../database/database.providers.js';
import type { DecisionService } from './decision.service.js';
import { MAX_ATTEMPTS, SweeperService } from './sweeper.service.js';

class TestSweeperService extends SweeperService {
  findStuck = vi.fn(async (_now: Date) => [] as { id: string; attemptCount: number }[]);
}

function setup(intervalMs = 0) {
  const decisions = {
    reclaimExpiredLease: vi.fn(async (id: string) => `owner-${id}` as string | null),
    decide: vi.fn(async () => true),
    escalateAfterSystemFailure: vi.fn(async () => true),
  };
  const service = new TestSweeperService({} as Database, intervalMs, decisions as unknown as DecisionService);
  return { service, decisions };
}

describe('SweeperService', () => {
  it('re-runs the normal decision for a stuck request it takes over', async () => {
    const { service, decisions } = setup();
    service.findStuck.mockResolvedValue([{ id: 'a', attemptCount: 1 }]);
    await expect(service.sweepOnce()).resolves.toEqual({ found: 1, decided: 1, escalated: 0, retryLater: 0 });
    expect(decisions.decide).toHaveBeenCalledWith('a', 'owner-a');
  });

  it('skips a request another caller took over first', async () => {
    const { service, decisions } = setup();
    service.findStuck.mockResolvedValue([{ id: 'a', attemptCount: 1 }]);
    decisions.reclaimExpiredLease.mockResolvedValue(null);
    await expect(service.sweepOnce()).resolves.toEqual({ found: 1, decided: 0, escalated: 0, retryLater: 0 });
    expect(decisions.decide).not.toHaveBeenCalled();
  });

  it(`hands a request to a person after ${MAX_ATTEMPTS} attempts`, async () => {
    const { service, decisions } = setup();
    service.findStuck.mockResolvedValue([{ id: 'a', attemptCount: MAX_ATTEMPTS }]);
    await expect(service.sweepOnce()).resolves.toMatchObject({ escalated: 1, decided: 0 });
    expect(decisions.escalateAfterSystemFailure).toHaveBeenCalledWith('a', 'owner-a', MAX_ATTEMPTS);
    expect(decisions.decide).not.toHaveBeenCalled();
  });

  it('counts a failed attempt for retry and carries on with the batch', async () => {
    const { service, decisions } = setup();
    service.findStuck.mockResolvedValue([{ id: 'a', attemptCount: 1 }, { id: 'b', attemptCount: 1 }]);
    decisions.decide.mockRejectedValueOnce(new Error('database gone'));
    await expect(service.sweepOnce()).resolves.toEqual({ found: 2, decided: 1, escalated: 0, retryLater: 1 });
  });

  it('never runs two timer passes at once, and survives a failed pass', async () => {
    const { service } = setup();
    let release!: () => void;
    service.findStuck.mockReturnValueOnce(new Promise((resolve) => (release = () => resolve([]))));
    const first = service.sweep();
    expect(service.sweep()).toBe(first);
    release();
    await first;
    service.findStuck.mockRejectedValueOnce(new Error('boom'));
    await expect(service.sweep()).resolves.toBeNull();
  });

  it('starts no timer when the interval is 0', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    setup(0).service.onApplicationBootstrap();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
