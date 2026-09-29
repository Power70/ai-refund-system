import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../database/database.providers.js';
import { customers, decisions, orderItems, orders, refundRequests, reviewResolutions } from '../database/schema.js';
import { OrdersService } from '../orders/orders.service.js';
import { escapeLike } from './admin.service.js';
import type { AdminCustomerDetailDto, AdminCustomerListDto, AdminCustomersQueryDto } from './dto/admin.dto.js';

@Injectable()
export class AdminCustomersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly orders: OrdersService,
  ) {}

  async list(query: AdminCustomersQueryDto): Promise<AdminCustomerListDto> {
    const where = query.q ? or(ilike(customers.name, `%${escapeLike(query.q)}%`), ilike(customers.email, `%${escapeLike(query.q)}%`)) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          customerId: customers.id,
          name: customers.name,
          email: customers.email,
          // Raw SQL with explicit aliases: Drizzle leaves column names unqualified in subqueries.
          orders: sql<number>`(select count(*) from orders o where o.customer_id = customers.id)::int`,
          requests: sql<number>`(select count(*) from refund_requests r where r.customer_id = customers.id)::int`,
          openRequests: sql<number>`(
            select count(*) from refund_requests r
            left join decisions d on d.request_id = r.id
            left join review_resolutions v on v.request_id = r.id
            where r.customer_id = customers.id and v.id is null and (d.id is null or d.status = 'ESCALATED')
          )::int`,
          refundedMinor: sql<number>`(
            select coalesce(sum(l.amount_minor), 0) from refund_request_lines l
            join refund_requests r on r.id = l.request_id
            where r.customer_id = customers.id and l.final_line_status = 'REFUNDED'
          )::int`,
        })
        .from(customers)
        .where(where)
        .orderBy(asc(customers.name), asc(customers.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ total: sql<number>`count(*)::int` }).from(customers).where(where),
    ]);
    return { items: rows, total, page: query.page, pageSize: query.pageSize };
  }

  async detail(customerId: string): Promise<AdminCustomerDetailDto | null> {
    const [customer] = await this.db.select().from(customers).where(eq(customers.id, customerId));
    if (!customer) return null;

    const orderRows = await this.db.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.placedAt));
    const itemRows = orderRows.length
      ? await this.db.select().from(orderItems).where(inArray(orderItems.orderId, orderRows.map((o) => o.id))).orderBy(asc(orderItems.name))
      : [];
    const quantities = await this.orders.itemQuantities(itemRows.map((i) => i.id));

    const requestRows = await this.db
      .select({
        request: refundRequests,
        orderNumber: orders.orderNumber,
        status: decisions.status,
        decidedAmountMinor: decisions.approvedAmountMinor,
        resolution: reviewResolutions.outcome,
        resolvedAmountMinor: reviewResolutions.approvedAmountMinor,
        requestedMinor: sql<number>`(select coalesce(sum(l.amount_minor), 0) from refund_request_lines l where l.request_id = refund_requests.id)::int`,
      })
      .from(refundRequests)
      .innerJoin(orders, eq(orders.id, refundRequests.orderId))
      .leftJoin(decisions, eq(decisions.requestId, refundRequests.id))
      .leftJoin(reviewResolutions, eq(reviewResolutions.requestId, refundRequests.id))
      .where(eq(refundRequests.customerId, customerId))
      .orderBy(desc(refundRequests.createdAt));

    const orderViews = orderRows.map((order) => {
      const items = itemRows
        .filter((item) => item.orderId === order.id)
        .map((item) => {
          const q = quantities.get(item.id);
          return {
            name: item.name,
            sku: item.sku,
            quantity: item.quantity,
            unitPricePaidMinor: item.unitPricePaidMinor,
            finalSale: item.finalSale,
            refundedQuantity: q?.refunded ?? 0,
            pendingQuantity: q?.pending ?? 0,
          };
        });
      return {
        orderNumber: order.orderNumber,
        placedAt: order.placedAt.toISOString(),
        deliveredAt: order.deliveredAt?.toISOString() ?? null,
        currency: order.currency,
        totalMinor: items.reduce((sum, i) => sum + i.quantity * i.unitPricePaidMinor, 0),
        refundedMinor: items.reduce((sum, i) => sum + i.refundedQuantity * i.unitPricePaidMinor, 0),
        items,
      };
    });

    return {
      customer: { customerId: customer.id, name: customer.name, email: customer.email, createdAt: customer.createdAt.toISOString() },
      orders: orderViews,
      requests: requestRows.map((r) => ({
        requestId: r.request.publicId,
        orderNumber: r.orderNumber,
        createdAt: r.request.createdAt.toISOString(),
        reason: r.request.reasonConfirmed,
        status: r.status ?? 'PROCESSING',
        resolution: r.resolution ?? null,
        requestedAmountMinor: r.requestedMinor,
        approvedAmountMinor: r.resolvedAmountMinor ?? r.decidedAmountMinor ?? 0,
      })),
      totals: {
        orderedMinor: orderViews.reduce((sum, o) => sum + o.totalMinor, 0),
        refundedMinor: orderViews.reduce((sum, o) => sum + o.refundedMinor, 0),
      },
    };
  }
}
