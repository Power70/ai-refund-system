import { ApiProperty } from '@nestjs/swagger';
import { AiStatusDto } from '../../health/dto/ai-status.dto.js';
import { EscalationReasonCountDto } from './escalation-reason-count.dto.js';
import { RequestCountsDto } from './request-counts.dto.js';
import { ResolutionCountsDto } from './resolution-counts.dto.js';

export class AdminMetricsDto {
  @ApiProperty() generatedAt: string;
  @ApiProperty({ type: RequestCountsDto }) requests: RequestCountsDto;
  @ApiProperty({ type: ResolutionCountsDto, description: 'What people decided on escalations' }) resolutions: ResolutionCountsDto;
  @ApiProperty({ type: [EscalationReasonCountDto], description: 'Most common first (top 10)' }) topEscalationReasons: EscalationReasonCountDto[];
  @ApiProperty({ description: 'Requests stuck in processing after their lease ran out. Healthy: 0' }) stuckProcessingCount: number;
  @ApiProperty({ type: AiStatusDto }) ai: AiStatusDto;
}
