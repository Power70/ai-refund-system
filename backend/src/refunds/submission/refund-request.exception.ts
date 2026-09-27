import { HttpException, HttpStatus } from '@nestjs/common';

export type RefundRequestErrorCode =
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'ORDER_OR_ITEM_NOT_FOUND'
  | 'ALREADY_IN_PROGRESS'
  | 'NOTHING_LEFT_TO_REFUND'
  | 'QUANTITY_TOO_HIGH'
  | 'NO_ACTIVE_POLICY';

const STATUS: Record<RefundRequestErrorCode, HttpStatus> = {
  IDEMPOTENCY_KEY_REQUIRED: HttpStatus.BAD_REQUEST,
  IDEMPOTENCY_KEY_REUSED: HttpStatus.CONFLICT,
  ORDER_OR_ITEM_NOT_FOUND: HttpStatus.NOT_FOUND,
  ALREADY_IN_PROGRESS: HttpStatus.CONFLICT,
  NOTHING_LEFT_TO_REFUND: HttpStatus.UNPROCESSABLE_ENTITY,
  QUANTITY_TOO_HIGH: HttpStatus.UNPROCESSABLE_ENTITY,
  NO_ACTIVE_POLICY: HttpStatus.SERVICE_UNAVAILABLE,
};

/** A refund request error with a stable code the frontend can act on, and a plain message. */
export class RefundRequestException extends HttpException {
  constructor(readonly code: RefundRequestErrorCode, message: string) {
    super({ statusCode: STATUS[code], code, message }, STATUS[code]);
  }
}
