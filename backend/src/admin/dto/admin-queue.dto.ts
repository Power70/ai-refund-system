import { ApiProperty } from '@nestjs/swagger';

export class AdminQueueRowDto {
  @ApiProperty({ example: 'rr_7k3p9qa2mx4d' }) requestId: string;
  @ApiProperty() createdAt: string;
  @ApiProperty({ enum: ['CUSTOMER', 'SEED'], description: 'SEED = demo history loaded at startup' }) source: string;
  @ApiProperty() customerName: string;
  @ApiProperty() customerEmail: string;
  @ApiProperty() orderNumber: string;
  @ApiProperty() reason: string;
  @ApiProperty({ description: 'Cents' }) requestedAmountMinor: number;
  @ApiProperty({ enum: ['PROCESSING', 'APPROVED', 'DENIED', 'ESCALATED'] }) status: string;
  @ApiProperty({ description: 'Cents' }) approvedAmountMinor: number;
  @ApiProperty({ type: [String], description: 'Why it went to a person (escalations) or which rules decided it' }) reasons: string[];
  @ApiProperty({ nullable: true, enum: ['APPROVED', 'PARTIALLY_APPROVED', 'DENIED'] }) resolution: string | null;
}

export class AdminQueueDto {
  @ApiProperty({ type: [AdminQueueRowDto] }) items: AdminQueueRowDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}
