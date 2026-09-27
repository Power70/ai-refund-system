import { ApiProperty } from '@nestjs/swagger';

export class AiStatusDto {
  @ApiProperty({ enum: ['ok', 'degraded', 'disabled'] }) status: string;
  @ApiProperty({ nullable: true, type: String, example: 'anthropic' }) provider: string | null;
  @ApiProperty({ nullable: true, type: String }) model: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Kind of the most recent failure' }) lastError: string | null;
}

export class RequestCountsDto {
  @ApiProperty() total: number;
  @ApiProperty() last24Hours: number;
  @ApiProperty({ description: 'Not yet decided' }) processing: number;
  @ApiProperty({ description: 'Automated decision' }) approved: number;
  @ApiProperty({ description: 'Automated decision' }) denied: number;
  @ApiProperty({ description: 'Automated decision' }) escalated: number;
  @ApiProperty({ description: 'Escalations without a resolution' }) awaitingReview: number;
}

export class ResolutionCountsDto {
  @ApiProperty() approved: number;
  @ApiProperty() partiallyApproved: number;
  @ApiProperty() denied: number;
}

export class EscalationReasonCountDto {
  @ApiProperty({ example: 'HIGH_VALUE' }) reason: string;
  @ApiProperty() count: number;
}

export class AdminMetricsDto {
  @ApiProperty() generatedAt: string;
  @ApiProperty({ type: RequestCountsDto }) requests: RequestCountsDto;
  @ApiProperty({ type: ResolutionCountsDto }) resolutions: ResolutionCountsDto;
  @ApiProperty({ type: [EscalationReasonCountDto], description: 'Top 10, most frequent first' }) topEscalationReasons: EscalationReasonCountDto[];
  @ApiProperty({ description: 'Expected to be 0' }) stuckProcessingCount: number;
  @ApiProperty({ type: AiStatusDto }) ai: AiStatusDto;
}

export class AdminHealthDto {
  @ApiProperty({ enum: ['ok', 'degraded'] }) status: 'ok' | 'degraded';
  @ApiProperty({ enum: ['ok', 'unreachable'] }) database: 'ok' | 'unreachable';
  @ApiProperty({ type: AiStatusDto, description: '"disabled" is a supported mode and does not degrade health' }) ai: AiStatusDto;
  @ApiProperty({ nullable: true, type: String }) policyVersion: string | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Expected to be 0' }) stuckProcessingCount: number | null;
  @ApiProperty() checkedAt: string;
}
