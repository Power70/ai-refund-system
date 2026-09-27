import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { registerDecorator, type ValidationOptions, ArrayMaxSize, ArrayMinSize, IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { REFUND_REASONS, type RefundReason } from '../policy/policy-schema.js';

/** Validates that an array of objects has no two entries with the same `key`. */
export function ArrayUniqueBy(key: string, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'arrayUniqueBy',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate(value: unknown) {
          if (!Array.isArray(value)) return true;
          const keys = value.map((v) => (v as Record<string, unknown>)?.[key]);
          return new Set(keys).size === keys.length;
        },
      },
    });
  };
}

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

  @ApiPropertyOptional({ format: 'uuid', description: 'The chat this claim was confirmed in; omit for a claim filled in without chat' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

export class CustomerRequestLineViewDto {
  @ApiProperty({ example: 'Oxford shirt, blue' }) itemName: string;
  @ApiProperty({ example: 1 }) quantity: number;
  @ApiProperty({ enum: ['REFUNDED', 'NOT_REFUNDED', 'UNDER_REVIEW', 'PROCESSING'] }) outcome: string;
}

/** What a customer may see about their request: no rule ids, traces, flags or AI data. */
export class CustomerRequestViewDto {
  @ApiProperty({ example: 'rr_7k3p9qa2mx4d' }) requestId: string;
  @ApiProperty({ example: 'WN-7K3P9Q' }) orderNumber: string;
  @ApiProperty({ enum: ['PROCESSING', 'APPROVED', 'DENIED', 'ESCALATED'] }) status: string;
  @ApiProperty({ nullable: true, type: String }) customerMessage: string | null;
  @ApiProperty({ example: 4999, description: 'Cents' }) approvedAmountMinor: number;
  @ApiProperty({ type: [CustomerRequestLineViewDto] }) lines: CustomerRequestLineViewDto[];
  @ApiProperty() createdAt: string;
}
