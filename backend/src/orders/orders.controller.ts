import { Inject, Injectable, Controller, Get, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiCookieAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { CurrentCustomerId, CustomerAuthGuard, SESSION_COOKIE } from '../customer-auth/customer-auth.js';
import { DATABASE, type Database } from '../database/database.js';
import { orderItems, orders } from '../database/schema.js';
import { loadItemQuantities } from './item-quantities.js';

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

@Injectable()
export class CustomerOrdersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Only this customer's orders, newest first, with what is still refundable per item. */
  async list(customerId: string): Promise<CustomerOrdersResponseDto> {
    const orderRows = await this.db.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.placedAt));
    if (orderRows.length === 0) return { orders: [] };

    const itemRows = await this.db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderRows.map((o) => o.id)))
      .orderBy(asc(orderItems.name));
    const quantities = await loadItemQuantities(this.db, itemRows.map((i) => i.id));

    return {
      orders: orderRows.map((order) => ({
        orderNumber: order.orderNumber,
        placedAt: order.placedAt.toISOString(),
        deliveredAt: order.deliveredAt?.toISOString() ?? null,
        currency: order.currency,
        items: itemRows
          .filter((item) => item.orderId === order.id)
          .map((item) => {
            const q = quantities.get(item.id)!;
            return {
              id: item.id,
              name: item.name,
              quantity: item.quantity,
              unitPricePaidMinor: item.unitPricePaidMinor,
              finalSale: item.finalSale,
              refundedQuantity: q.refunded,
              pendingQuantity: q.pending,
              refundableQuantity: q.refundable,
            };
          }),
      })),
    };
  }
}

@ApiTags('customer orders')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('customer/orders')
@UseGuards(CustomerAuthGuard)
export class CustomerOrdersController {
  constructor(private readonly orders: CustomerOrdersService) {}

  @Get()
  @ApiOkResponse({ type: CustomerOrdersResponseDto })
  @ApiUnauthorizedResponse()
  list(@CurrentCustomerId() customerId: string): Promise<CustomerOrdersResponseDto> {
    return this.orders.list(customerId);
  }
}
