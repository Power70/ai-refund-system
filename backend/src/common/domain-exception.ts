import { HttpException, type HttpStatus } from '@nestjs/common';

/** API error with a stable, machine-readable code. Response body: `{ statusCode, code, message }`. */
export class DomainException<Code extends string = string> extends HttpException {
  constructor(
    readonly code: Code,
    message: string,
    status: HttpStatus,
  ) {
    super({ statusCode: status, code, message }, status);
  }
}

/** Returns a typed factory for a module's error codes, each bound to its HTTP status. */
export function domainErrors<Code extends string>(statuses: Record<Code, HttpStatus>) {
  return (code: Code, message: string): DomainException<Code> => new DomainException(code, message, statuses[code]);
}
