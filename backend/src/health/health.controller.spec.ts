import type { Response } from 'express';
import { HealthController } from './health.controller.js';
import type { HealthService } from './health.service.js';

function setup(reachable: boolean) {
  const res = { status: vi.fn() };
  const controller = new HealthController({ isDatabaseReachable: vi.fn().mockResolvedValue(reachable) } as unknown as HealthService);
  return { controller, res: res as unknown as Response & typeof res };
}

describe('HealthController', () => {
  it('reports ok while the database answers', async () => {
    const { controller, res } = setup(true);
    await expect(controller.check(res)).resolves.toEqual({ status: 'ok' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('reports degraded with 503 when it does not, and nothing internal', async () => {
    const { controller, res } = setup(false);
    await expect(controller.check(res)).resolves.toEqual({ status: 'degraded' });
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
