import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module.js';
import { CustomerOrdersController } from './customer-orders.controller.js';
import { CustomerOrdersService } from './customer-orders.service.js';

@Module({
  imports: [CustomerAuthModule],
  controllers: [CustomerOrdersController],
  providers: [CustomerOrdersService],
})
export class OrdersModule {}
