import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentCustomerId } from '../auth/decorators/current-customer.decorator.js';
import { CustomerAuthGuard } from '../auth/guards/customer-auth.guard.js';
import { SESSION_COOKIE } from '../auth/session-token.js';
import { CustomerOrdersResponseDto } from './dto/orders.dto.js';
import { OrdersService } from './orders.service.js';

@ApiTags('customer orders')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('customer/orders')
@UseGuards(CustomerAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** The signed-in customer's orders only. */
  @Get()
  @ApiOkResponse({ type: CustomerOrdersResponseDto })
  @ApiUnauthorizedResponse()
  list(@CurrentCustomerId() customerId: string): Promise<CustomerOrdersResponseDto> {
    return this.orders.listForCustomer(customerId);
  }
}
