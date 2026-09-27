import type { CustomerRequestViewDto } from './dto/customer-request-view.dto.js';

/** created: a new request (201); replayed: same key and claim seen before (200). */
export interface SubmissionOutcome {
  kind: 'created' | 'replayed';
  view: CustomerRequestViewDto;
}
