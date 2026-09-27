import { HttpException, HttpStatus } from '@nestjs/common';

export type ResolutionErrorCode = 'REQUEST_NOT_FOUND' | 'NOT_ESCALATED' | 'ALREADY_RESOLVED' | 'LINES_MISMATCH';

const STATUS: Record<ResolutionErrorCode, HttpStatus> = {
  REQUEST_NOT_FOUND: HttpStatus.NOT_FOUND,
  NOT_ESCALATED: HttpStatus.CONFLICT,
  ALREADY_RESOLVED: HttpStatus.CONFLICT,
  LINES_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
};

/** A resolution error with a stable code the admin UI can act on, and a plain message. */
export class ResolutionException extends HttpException {
  constructor(readonly code: ResolutionErrorCode, message: string) {
    super({ statusCode: STATUS[code], code, message }, STATUS[code]);
  }
}
