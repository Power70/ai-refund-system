import { ApiProperty } from '@nestjs/swagger';

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
