import { ApiProperty } from '@nestjs/swagger';

export class AiStatusDto {
  @ApiProperty({ enum: ['ok', 'degraded', 'disabled'] }) status: string;
  @ApiProperty({ nullable: true, type: String, example: 'anthropic' }) provider: string | null;
  @ApiProperty({ nullable: true, type: String }) model: string | null;
}
