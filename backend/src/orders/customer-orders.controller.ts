import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentCustomerId } from '../customer-auth/current-customer-id.decorator.js';
import { CustomerAuthGuard } from '../customer-auth/customer-auth.guard.js';
import { SESSION_COOKIE } from '../customer-auth/session-cookie.js';
import { CustomerOrdersService } from './customer-orders.service.js';
import { CustomerOrdersResponseDto } from './dto/customer-order.dto.js';

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
