import { desc, eq } from 'drizzle-orm';
import type { Database } from '../../database/database.types.js';
import { refundRequests } from '../../database/schema/index.js';
import type { CustomerRequestViewDto } from './dto/customer-request-view.dto.js';
import { loadCustomerRequestView } from './load-customer-request-view.js';

/** "My requests": the customer's own requests, newest first (bounded). */
export async function listCustomerRequests(db: Database, customerId: string, limit = 50): Promise<CustomerRequestViewDto[]> {
  const rows = await db
    .select({ id: refundRequests.id })
    .from(refundRequests)
    .where(eq(refundRequests.customerId, customerId))
    .orderBy(desc(refundRequests.createdAt))
    .limit(limit);
  const views = await Promise.all(rows.map((r) => loadCustomerRequestView(db, customerId, { requestId: r.id })));
  return views.filter((v): v is CustomerRequestViewDto => v !== null);
}
