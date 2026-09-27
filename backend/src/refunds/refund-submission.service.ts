import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { LlmService } from '../ai/llm.service.js';
import type { Env } from '../config/env.js';
import { summarizeCase } from '../conversations/case-summary.js';
import { DATABASE, pgErrorCode, type Database } from '../database/database.js';
import { refundRequests } from '../database/schema.js';
import { canonicalJson } from '../policy/policy-registry.js';
import { decideRequest } from './decide-request.js';
import { IdempotentReplaySignal, loadCustomerRequestView, reclaimExpiredLease, RefundRequestException, reserveRequest } from './refund-requests.js';
import type { CustomerRequestViewDto, SubmitRefundRequestDto } from './refunds.dto.js';

/** created: a new request (201); replayed: same key and claim seen before (200). */
export interface SubmissionOutcome {
  kind: 'created' | 'replayed';
  view: CustomerRequestViewDto;
}

/** Identifies the claim itself: line order doesn't matter, any real change does. */
export function computePayloadHash(dto: SubmitRefundRequestDto): string {
  const claim = {
    orderNumber: dto.orderNumber,
    reason: dto.reason,
    lines: [...dto.lines].map((l) => ({ itemId: l.itemId.toLowerCase(), quantity: l.quantity })).sort((a, b) => a.itemId.localeCompare(b.itemId)),
    // Included only when present, so hashes of claims without a conversation are unchanged.
    ...(dto.conversationId ? { conversationId: dto.conversationId.toLowerCase() } : {}),
  };
  return createHash('sha256').update(canonicalJson(claim)).digest('hex');
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class RefundSubmissionService {
  private readonly logger = new Logger(RefundSubmissionService.name);
  private readonly minConfidence: number;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly llm: LlmService,
    config: ConfigService<Env, true>,
  ) {
    this.minConfidence = config.get('AI_MIN_CONFIDENCE', { infer: true });
  }

  /**
   * Submits a confirmed claim exactly once per idempotency key:
   *  - new key: reserve (transaction 1), decide, store (transaction 2);
   *  - same key, same claim: return what is already stored (finishing it if its worker died);
   *  - same key, different claim: 409.
   */
  async submit(customerId: string, idempotencyKey: string | undefined, dto: SubmitRefundRequestDto): Promise<SubmissionOutcome> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new RefundRequestException('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header (8–100 letters, digits, - or _) is required.');
    }
    const payloadHash = computePayloadHash(dto);

    const replay = await this.replay(customerId, idempotencyKey, payloadHash);
    if (replay) return replay;

    let reserved: { requestId: string; leaseOwner: string };
    try {
      reserved = await reserveRequest(this.db, customerId, idempotencyKey, payloadHash, dto);
    } catch (error) {
      // A simultaneous retry with the same key won: answer with its result.
      if (error instanceof IdempotentReplaySignal || pgErrorCode(error) === UNIQUE_VIOLATION) {
        const concurrent = await this.replay(customerId, idempotencyKey, payloadHash);
        if (concurrent) return concurrent;
      }
      throw error;
    }

    await this.decideSafely(reserved.requestId, reserved.leaseOwner);
    // Advisory note for reviewers; runs after the response so it never delays the customer.
    void summarizeCase(this.db, this.llm, reserved.requestId);
    return { kind: 'created', view: (await loadCustomerRequestView(this.db, customerId, { requestId: reserved.requestId }))! };
  }

  private async replay(customerId: string, idempotencyKey: string, payloadHash: string): Promise<SubmissionOutcome | null> {
    const [existing] = await this.db
      .select()
      .from(refundRequests)
      .where(and(eq(refundRequests.customerId, customerId), eq(refundRequests.idempotencyKey, idempotencyKey)));
    if (!existing) return null;
    if (existing.payloadHash !== payloadHash) {
      throw new RefundRequestException('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.');
    }
    if (existing.state === 'PROCESSING' && existing.leaseExpiresAt && existing.leaseExpiresAt < new Date()) {
      const leaseOwner = await reclaimExpiredLease(this.db, existing.id);
      if (leaseOwner) await this.decideSafely(existing.id, leaseOwner);
    }
    return { kind: 'replayed', view: (await loadCustomerRequestView(this.db, customerId, { requestId: existing.id }))! };
  }

  /**
   * A failure here leaves the request PROCESSING with its reservation: the customer sees
   * "processing", and a retry (or the sweeper) finishes it once the lease expires.
   */
  private async decideSafely(requestId: string, leaseOwner: string): Promise<void> {
    try {
      await decideRequest(this.db, requestId, leaseOwner, { minConfidence: this.minConfidence, llm: this.llm });
    } catch (error) {
      this.logger.error(`Deciding request ${requestId} failed; it stays PROCESSING for retry`, (error as Error).stack);
    }
  }
}
