import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded'], example: 'ok' }) status: 'ok' | 'degraded';
}

export class AiStatusDto {
  @ApiProperty({ enum: ['ok', 'degraded', 'disabled'] }) status: string;
  @ApiProperty({ nullable: true, type: String, example: 'anthropic' }) provider: string | null;
  @ApiProperty({ nullable: true, type: String }) model: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Kind of the most recent failure' }) lastError: string | null;
}

export class DetailedHealthDto {
  @ApiProperty({ enum: ['ok', 'degraded'] }) status: 'ok' | 'degraded';
  @ApiProperty({ enum: ['ok', 'unreachable'] }) database: 'ok' | 'unreachable';
  @ApiProperty({ type: AiStatusDto, description: '"disabled" is a supported mode and does not degrade health' }) ai: AiStatusDto;
  @ApiProperty({ nullable: true, type: String }) policyVersion: string | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Expected to be 0' }) stuckProcessingCount: number | null;
  @ApiProperty() checkedAt: string;
}
