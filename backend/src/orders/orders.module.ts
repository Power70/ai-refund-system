import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module.js';
import { CustomerOrdersController, CustomerOrdersService } from './orders.controller.js';

@Module({
  imports: [CustomerAuthModule],
  controllers: [CustomerOrdersController],
  providers: [CustomerOrdersService],
})
export class OrdersModule {}
