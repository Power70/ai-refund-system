import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const QUEUE_VIEWS = ['needs-review', 'all'] as const;
export const QUEUE_STATUSES = ['PROCESSING', 'APPROVED', 'DENIED', 'ESCALATED'] as const;

export class AdminQueueQueryDto {
  @ApiPropertyOptional({ enum: QUEUE_VIEWS, default: 'all', description: 'needs-review: unresolved escalations, oldest first' })
  @IsOptional()
  @IsIn(QUEUE_VIEWS)
  view: (typeof QUEUE_VIEWS)[number] = 'all';

  @ApiPropertyOptional({ enum: QUEUE_STATUSES, description: 'Automated decision status' })
  @IsOptional()
  @IsIn(QUEUE_STATUSES)
  status?: (typeof QUEUE_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Request id, order number, customer name or email' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
