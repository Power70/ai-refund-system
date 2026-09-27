import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request.types.js';

/** The signed-in customer's id (set by CustomerAuthGuard). */
export const CurrentCustomerId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => context.switchToHttp().getRequest<AuthenticatedRequest>().customerId,
);
