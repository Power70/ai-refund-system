import { ApiProperty } from '@nestjs/swagger';

export class CustomerOrderItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Oxford shirt, blue' }) name: string;
  @ApiProperty({ example: 1 }) quantity: number;
  @ApiProperty({ example: 4999, description: 'Price paid per unit, in cents' }) unitPricePaidMinor: number;
  @ApiProperty() finalSale: boolean;
  @ApiProperty({ example: 0 }) refundedQuantity: number;
  @ApiProperty({ example: 0, description: 'Awaiting review or still being processed' }) pendingQuantity: number;
  @ApiProperty({ example: 1 }) refundableQuantity: number;
}

export class CustomerOrderDto {
  @ApiProperty({ example: 'WN-7K3P9Q' }) orderNumber: string;
  @ApiProperty() placedAt: string;
  @ApiProperty({ nullable: true, type: String }) deliveredAt: string | null;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ type: [CustomerOrderItemDto] }) items: CustomerOrderItemDto[];
}

export class CustomerOrdersResponseDto {
  @ApiProperty({ type: [CustomerOrderDto] }) orders: CustomerOrderDto[];
}
