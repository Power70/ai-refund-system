import type { Database } from '../database/database.providers.js';
import type { OrdersService } from '../orders/orders.service.js';
import type { PolicyService } from '../policy/policy.service.js';
import { DomainException } from '../common/domain-exception.js';
import type { DecisionService } from './decision.service.js';
import type { CustomerRequestViewDto, SubmitRefundRequestDto } from './dto/refunds.dto.js';
import { computePayloadHash, RefundsService, type SubmissionOutcome } from './refunds.service.js';
import type { ReviewSummaryService } from './review-summary.service.js';

const claim = (overrides: Partial<Record<keyof SubmitRefundRequestDto, unknown>> = {}) =>
  ({
    orderNumber: 'WN-7K3P9Q',
    reason: 'DAMAGED',
    lines: [
      { itemId: 'B0000000-0000-4000-8000-000000000002', quantity: 1 },
      { itemId: 'a0000000-0000-4000-8000-000000000001', quantity: 2 },
    ],
    ...overrides,
  }) as SubmitRefundRequestDto;
const dto = claim();
const KEY = 'key-12345678';
const view = { requestId: 'rr_abcdefghjkmn', status: 'APPROVED' } as CustomerRequestViewDto;

class TestRefundsService extends RefundsService {
  replay = vi.fn(async (): Promise<SubmissionOutcome | null> => null);
  reserve = vi.fn(async () => ({ requestId: 'req-1', leaseOwner: 'owner-1' }));
  view = vi.fn(async () => view as CustomerRequestViewDto | null);
}

function setup() {
  const decisions = { decide: vi.fn(async () => true) };
  const summaries = { summarize: vi.fn(async () => undefined) };
  const service = new TestRefundsService(
    {} as Database,
    {} as OrdersService,
    {} as PolicyService,
    decisions as unknown as DecisionService,
    summaries as unknown as ReviewSummaryService,
  );
  return { service, decisions, summaries };
}

describe('computePayloadHash', () => {
  it('ignores line order and item id case', () => {
    const reordered = claim({ lines: dto.lines.toReversed().map((l) => ({ itemId: l.itemId.toUpperCase(), quantity: l.quantity })) });
    expect(computePayloadHash(reordered)).toBe(computePayloadHash(dto));
  });

  it('changes with any real change to the claim', () => {
    expect(computePayloadHash(claim({ reason: 'WRONG_ITEM' }))).not.toBe(computePayloadHash(dto));
    expect(computePayloadHash(claim({ lines: [{ itemId: dto.lines[0].itemId, quantity: 2 }, dto.lines[1]] }))).not.toBe(computePayloadHash(dto));
    expect(computePayloadHash(claim({ conversationId: 'c0000000-0000-4000-8000-000000000003' }))).not.toBe(computePayloadHash(dto));
  });
});

describe('RefundsService.submit', () => {
  it.each([undefined, 'short', 'has spaces in it', 'x'.repeat(101)])('requires a well-formed idempotency key (%s)', async (key) => {
    const { service } = setup();
    await expect(service.submit('cust-1', key, dto)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(service.reserve).not.toHaveBeenCalled();
  });

  it('reserves, decides under the lease, then summarises in the background', async () => {
    const { service, decisions, summaries } = setup();
    await expect(service.submit('cust-1', KEY, dto)).resolves.toEqual({ kind: 'created', view });
    expect(service.reserve).toHaveBeenCalledWith('cust-1', KEY, computePayloadHash(dto), dto);
    expect(decisions.decide).toHaveBeenCalledWith('req-1', 'owner-1');
    expect(summaries.summarize).toHaveBeenCalledWith('req-1');
    expect(service.view).toHaveBeenCalledWith('cust-1', { requestId: 'req-1' });
  });

  it('answers a repeated key with the stored request, without reserving again', async () => {
    const { service } = setup();
    service.replay.mockResolvedValue({ kind: 'replayed', view });
    await expect(service.submit('cust-1', KEY, dto)).resolves.toEqual({ kind: 'replayed', view });
    expect(service.reserve).not.toHaveBeenCalled();
  });

  it('answers with the winner when a simultaneous retry reserved first', async () => {
    const { service } = setup();
    service.reserve.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
    service.replay.mockResolvedValueOnce(null).mockResolvedValueOnce({ kind: 'replayed', view });
    await expect(service.submit('cust-1', KEY, dto)).resolves.toEqual({ kind: 'replayed', view });
  });

  it('passes reservation errors through', async () => {
    const { service } = setup();
    const error = new DomainException('QUANTITY_TOO_HIGH', 'Only 1 of this item can be refunded.', 422);
    service.reserve.mockRejectedValue(error);
    await expect(service.submit('cust-1', KEY, dto)).rejects.toBe(error);
  });

  it('keeps the request for retry when deciding fails', async () => {
    const { service, decisions } = setup();
    decisions.decide.mockRejectedValue(new Error('provider down'));
    await expect(service.submit('cust-1', KEY, dto)).resolves.toMatchObject({ kind: 'created' });
  });
});
