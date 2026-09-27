import { SetMetadata } from '@nestjs/common';

export const SUBMIT_RATE_LIMIT = 'rateLimit:submit';

/** Marks the refund submission route: 5 submissions per minute per customer. */
export const SubmitRateLimit = () => SetMetadata(SUBMIT_RATE_LIMIT, true);
