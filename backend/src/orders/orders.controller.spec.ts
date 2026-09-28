import { OrdersController } from './orders.controller.js';
import type { OrdersService } from './orders.service.js';

describe('OrdersController', () => {
  it("lists only the signed-in customer's orders", async () => {
    const orders = { listForCustomer: vi.fn().mockResolvedValue({ orders: [] }) };
    await expect(new OrdersController(orders as unknown as OrdersService).list('customer-1')).resolves.toEqual({ orders: [] });
    expect(orders.listForCustomer).toHaveBeenCalledWith('customer-1');
  });
});
