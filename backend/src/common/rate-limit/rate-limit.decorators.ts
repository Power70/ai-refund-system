import { SetMetadata } from '@nestjs/common';

export const LOGIN_RATE_LIMIT = 'rateLimit:login';
export const SUBMIT_RATE_LIMIT = 'rateLimit:submit';
export const CHAT_RATE_LIMIT = 'rateLimit:chat';

/** Sign-in route: stricter per-IP limit. */
export const LoginRateLimit = () => SetMetadata(LOGIN_RATE_LIMIT, true);
/** Refund submission: 5 per minute per customer. */
export const SubmitRateLimit = () => SetMetadata(SUBMIT_RATE_LIMIT, true);
/** Chat messages (each may cost an AI call): 20 per minute per customer. */
export const ChatRateLimit = () => SetMetadata(CHAT_RATE_LIMIT, true);
