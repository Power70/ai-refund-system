import { NotFoundException } from '@nestjs/common';
import type { HealthService } from '../health/health.service.js';
import { AdminController } from './admin.controller.js';
import type { AdminService } from './admin.service.js';
import type { AdminQueueQueryDto, CaseBriefDto, ResolveEscalationDto } from './dto/admin.dto.js';
import type { ResolutionService } from './resolution.service.js';

const ID = 'rr_abcdefghjkmn';
const brief = { request: { requestId: ID } } as CaseBriefDto;

function setup() {
  const admin = { queue: vi.fn(), caseBrief: vi.fn(async () => brief as CaseBriefDto | null), metrics: vi.fn() };
  const resolutions = { resolve: vi.fn(async () => undefined) };
  const health = { detailed: vi.fn() };
  const controller = new AdminController(admin as unknown as AdminService, resolutions as unknown as ResolutionService, health as unknown as HealthService);
  return { admin, resolutions, health, controller };
}

describe('AdminController', () => {
  it('passes the validated queue query through', async () => {
    const { admin, controller } = setup();
    const query = { view: 'needs-review', page: 1, pageSize: 20 } as AdminQueueQueryDto;
    await controller.queue(query);
    expect(admin.queue).toHaveBeenCalledWith(query);
  });

  it('returns a case brief, or 404s', async () => {
    const { admin, controller } = setup();
    await expect(controller.caseBrief(ID)).resolves.toBe(brief);
    admin.caseBrief.mockResolvedValue(null);
    await expect(controller.caseBrief(ID)).rejects.toThrow(NotFoundException);
  });

  it('resolves, then returns the updated brief', async () => {
    const { admin, resolutions, controller } = setup();
    const body = { lineDecisions: [{ lineId: 'l1', approve: true }], reviewerNote: 'ok' } as ResolveEscalationDto;
    await expect(controller.resolve(ID, body)).resolves.toBe(brief);
    expect(resolutions.resolve).toHaveBeenCalledWith(ID, body);
    expect(resolutions.resolve.mock.invocationCallOrder[0]).toBeLessThan(admin.caseBrief.mock.invocationCallOrder[0]);
  });

  it('serves metrics and detailed health', async () => {
    const { admin, health, controller } = setup();
    await controller.metrics();
    await controller.detailedHealth();
    expect(admin.metrics).toHaveBeenCalled();
    expect(health.detailed).toHaveBeenCalled();
  });
});
