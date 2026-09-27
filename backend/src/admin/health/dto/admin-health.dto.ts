import { ApiProperty } from '@nestjs/swagger';
import { AiStatusDto } from './ai-status.dto.js';

export class AdminHealthDto {
  @ApiProperty({ enum: ['ok', 'degraded'], description: 'degraded if the database is down, AI is failing, or requests are stuck' })
  status: 'ok' | 'degraded';
  @ApiProperty({ enum: ['ok', 'unreachable'] }) database: 'ok' | 'unreachable';
  @ApiProperty({ type: AiStatusDto, description: '"disabled" (no API key) is a supported mode, not a fault' }) ai: AiStatusDto;
  @ApiProperty({ nullable: true, type: String, description: 'Policy version in force now; null if the database is down' }) policyVersion: string | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Healthy: 0; null if the database is down' }) stuckProcessingCount: number | null;
  @ApiProperty() checkedAt: string;
}
