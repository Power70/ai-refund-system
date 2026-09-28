import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  customerId: string;
}

/** The signed-in customer's id, set by CustomerAuthGuard. */
export const CurrentCustomerId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => context.switchToHttp().getRequest<AuthenticatedRequest>().customerId,
);
