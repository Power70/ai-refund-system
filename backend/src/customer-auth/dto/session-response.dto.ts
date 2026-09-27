import { ApiProperty } from '@nestjs/swagger';

export class SessionResponseDto {
  @ApiProperty({ example: 'Ada' })
  firstName: string;

  @ApiProperty({ example: '2026-09-27T12:30:00.000Z' })
  expiresAt: string;
}
