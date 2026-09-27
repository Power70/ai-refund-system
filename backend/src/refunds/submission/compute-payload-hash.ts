import { createHash } from 'node:crypto';
import { canonicalJson } from '../../policy/registry/canonical-json.js';
import type { SubmitRefundRequestDto } from './dto/submit-refund-request.dto.js';

/** Identifies the claim itself: line order doesn't matter, any real change does. */
export function computePayloadHash(dto: SubmitRefundRequestDto): string {
  const claim = {
    orderNumber: dto.orderNumber,
    reason: dto.reason,
    lines: [...dto.lines].map((l) => ({ itemId: l.itemId.toLowerCase(), quantity: l.quantity })).sort((a, b) => a.itemId.localeCompare(b.itemId)),
  };
  return createHash('sha256').update(canonicalJson(claim)).digest('hex');
}
