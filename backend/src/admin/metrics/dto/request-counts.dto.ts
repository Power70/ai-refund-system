import { ApiProperty } from '@nestjs/swagger';

export class RequestCountsDto {
  @ApiProperty() total: number;
  @ApiProperty({ description: 'Requests created in the last 24 hours' }) last24Hours: number;
  @ApiProperty({ description: 'Not decided yet' }) processing: number;
  @ApiProperty({ description: 'Automated decision' }) approved: number;
  @ApiProperty({ description: 'Automated decision' }) denied: number;
  @ApiProperty({ description: 'Automated decision: sent to a person' }) escalated: number;
  @ApiProperty({ description: 'Escalations no one has resolved yet' }) awaitingReview: number;
}
