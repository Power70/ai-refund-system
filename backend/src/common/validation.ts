import { Injectable, NotFoundException, type PipeTransform } from '@nestjs/common';
import { registerDecorator, type ValidationOptions } from 'class-validator';
import { randomInt } from 'node:crypto';

/** Validates that an array of objects has no two entries with the same `key`. */
export function ArrayUniqueBy(key: string, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'arrayUniqueBy',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate(value: unknown) {
          if (!Array.isArray(value)) return true;
          const keys = value.map((v) => (v as Record<string, unknown>)?.[key]);
          return new Set(keys).size === keys.length;
        },
      },
    });
  };
}

// Crockford base32, lower-case: no i, l, o, u, so IDs are easy to read out over the phone.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const ID_LENGTH = 12;
const PUBLIC_REQUEST_ID = /^rr_[0-9a-hjkmnp-tv-z]{12}$/;

/**
 * Customer-facing request ID, e.g. "rr_7k3p9qa2mx4d": 60 random bits from a CSPRNG.
 * Not sequential or guessable; the column is unique as a backstop against collisions.
 */
export function generatePublicRequestId(): string {
  let id = 'rr_';
  for (let i = 0; i < ID_LENGTH; i++) id += ALPHABET[randomInt(ALPHABET.length)];
  return id;
}

/** Rejects malformed request IDs with 404 before any query runs. */
@Injectable()
export class ParsePublicRequestIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!PUBLIC_REQUEST_ID.test(value)) throw new NotFoundException('Request not found.');
    return value;
  }
}
