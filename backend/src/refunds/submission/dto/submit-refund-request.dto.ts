import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsInt, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { REFUND_REASONS, type RefundReason } from '../../../policy/refund-reasons.js';
import { ArrayUniqueBy } from './array-unique-by.validator.js';

export class RequestedLineDto {
  @ApiProperty({ format: 'uuid', description: 'Item id from GET /customer/orders' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: 99 })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;
}

/** The claim exactly as the customer confirmed it. Amounts are never accepted from the client. */
export class SubmitRefundRequestDto {
  @ApiProperty({ example: 'WN-7K3P9Q' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^WN-[A-Z0-9]{6}$/, { message: 'orderNumber looks like WN-7K3P9Q' })
  orderNumber: string;

  @ApiProperty({ enum: REFUND_REASONS })
  @IsIn(REFUND_REASONS)
  reason: RefundReason;

  @ApiProperty({ type: [RequestedLineDto] })
  @ValidateNested({ each: true })
  @Type(() => RequestedLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUniqueBy('itemId', { message: 'each item may appear only once' })
  lines: RequestedLineDto[];
}
