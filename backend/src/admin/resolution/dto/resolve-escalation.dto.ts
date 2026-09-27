import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ArrayUniqueBy } from '../../../refunds/submission/dto/array-unique-by.validator.js';
import { LineDecisionDto } from './line-decision.dto.js';

/** A reviewer's decision: yes or no for every line, plus a note. Amounts are never accepted. */
export class ResolveEscalationDto {
  @ApiProperty({ type: [LineDecisionDto], description: 'Exactly one decision for every line of the request' })
  @ValidateNested({ each: true })
  @Type(() => LineDecisionDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUniqueBy('lineId', { message: 'each line may appear only once' })
  lineDecisions: LineDecisionDto[];

  @ApiProperty({ minLength: 3, maxLength: 1000, description: 'Internal note explaining the decision (not shown to the customer)' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reviewerNote: string;
}
