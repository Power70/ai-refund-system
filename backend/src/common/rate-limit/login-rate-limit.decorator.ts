import { SetMetadata } from '@nestjs/common';

export const LOGIN_RATE_LIMIT = 'rateLimit:login';

/** Marks the sign-in route, which gets the stricter per-IP and per-email limits. */
export const LoginRateLimit = () => SetMetadata(LOGIN_RATE_LIMIT, true);
