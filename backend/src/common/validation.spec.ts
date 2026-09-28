import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ArrayUniqueBy, generatePublicRequestId, ParsePublicRequestIdPipe } from './validation.js';

describe('generatePublicRequestId', () => {
  it('matches the format the database enforces', () => {
    for (let i = 0; i < 1000; i++) expect(generatePublicRequestId()).toMatch(/^rr_[0-9a-hjkmnp-tv-z]{12}$/);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 10_000 }, generatePublicRequestId));
    expect(ids.size).toBe(10_000);
  });
});

describe('ParsePublicRequestIdPipe', () => {
  const pipe = new ParsePublicRequestIdPipe();

  it('passes a well-formed id through', () => {
    const id = generatePublicRequestId();
    expect(pipe.transform(id)).toBe(id);
  });

  it.each(['not-an-id', 'rr_ABCDEFGHJKMN', 'rr_abcdefghijkl', "rr_000000000000' OR 1=1"])('404s for %s', (value) => {
    expect(() => pipe.transform(value)).toThrow(NotFoundException);
  });
});

describe('ArrayUniqueBy', () => {
  class Payload {
    @ArrayUniqueBy('id')
    items: { id: string }[];
  }
  const errors = (items: unknown) => validateSync(plainToInstance(Payload, { items }));

  it('accepts distinct keys', () => {
    expect(errors([{ id: 'a' }, { id: 'b' }])).toHaveLength(0);
  });

  it('rejects a repeated key', () => {
    expect(errors([{ id: 'a' }, { id: 'a' }])[0].constraints).toHaveProperty('arrayUniqueBy');
  });
});
