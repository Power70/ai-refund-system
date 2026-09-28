import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import type { CustomerRequestViewDto, SubmitRefundRequestDto } from './dto/refunds.dto.js';
import { RefundsController } from './refunds.controller.js';
import type { RefundsService } from './refunds.service.js';

const dto = { orderNumber: 'WN-7K3P9Q', reason: 'DAMAGED', lines: [] } as unknown as SubmitRefundRequestDto;
const viewWith = (status: string) => ({ requestId: 'rr_abcdefghjkmn', status }) as CustomerRequestViewDto;

function setup() {
  const refunds = { submit: vi.fn(), list: vi.fn(), view: vi.fn() };
  const res = { status: vi.fn() };
  return { refunds, res: res as unknown as Response & typeof res, controller: new RefundsController(refunds as unknown as RefundsService) };
}

describe('RefundsController', () => {
  it.each([
    ['created', 'APPROVED', 201],
    ['replayed', 'DENIED', 200],
    ['created', 'PROCESSING', 202],
    ['replayed', 'PROCESSING', 202],
  ])('a %s %s request answers %i', async (kind, status, code) => {
    const { refunds, res, controller } = setup();
    refunds.submit.mockResolvedValue({ kind, view: viewWith(status) });
    await expect(controller.submit('cust-1', 'key-12345678', dto, res)).resolves.toEqual(viewWith(status));
    expect(refunds.submit).toHaveBeenCalledWith('cust-1', 'key-12345678', dto);
    expect(res.status).toHaveBeenCalledWith(code);
  });

  it("lists only the signed-in customer's requests", async () => {
    const { refunds, controller } = setup();
    refunds.list.mockResolvedValue([]);
    await controller.list('cust-1');
    expect(refunds.list).toHaveBeenCalledWith('cust-1');
  });

  it("404s for another customer's or an unknown request", async () => {
    const { refunds, controller } = setup();
    refunds.view.mockResolvedValue(null);
    await expect(controller.get('cust-1', 'rr_abcdefghjkmn')).rejects.toThrow(NotFoundException);
    expect(refunds.view).toHaveBeenCalledWith('cust-1', { publicId: 'rr_abcdefghjkmn' });
  });
});
