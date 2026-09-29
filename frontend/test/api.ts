import { http, HttpResponse, type JsonBodyType } from 'msw'
import { setupServer } from 'msw/node'
import type { AdminMetrics, CaseBrief, Conversation, CustomerDetail, CustomerRow, Order, QueueRow, RefundRequestView } from '../src/api/client'

/** Mock API; tests add handlers with `server.use`. */
export const server = setupServer()

/** Matches an API path on any origin. */
export const url = (path: string) => `*/api/v1${path}`

export const json = (body: JsonBodyType, status = 200) => HttpResponse.json(body, { status })

export const order: Order = {
  orderNumber: 'WN-7K3P9Q',
  placedAt: '2026-09-20T10:00:00Z',
  deliveredAt: '2026-09-23T10:00:00Z',
  currency: 'USD',
  items: [{ id: 'item-shirt', name: 'Oxford shirt, blue', quantity: 1, unitPricePaidMinor: 4999, finalSale: false, refundedQuantity: 0, pendingQuantity: 0, refundableQuantity: 1 }],
}

export function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    conversationId: 'conv-1',
    state: 'ACTIVE',
    mode: 'AI',
    requestId: null,
    messages: [],
    quickReplies: [],
    proposal: null,
    reasons: [
      { reason: 'DAMAGED', label: 'It arrived damaged or defective' },
      { reason: 'WRONG_ITEM', label: 'I received the wrong item' },
      { reason: 'CHANGED_MIND', label: 'I changed my mind' },
    ],
    ...overrides,
  }
}

export const proposal: Conversation['proposal'] = {
  orderId: 'order-1',
  orderNumber: 'WN-7K3P9Q',
  reason: 'DAMAGED',
  lines: [{ orderItemId: 'item-shirt', itemName: 'Oxford shirt, blue', quantity: 1, maxQuantity: 1 }],
}

export function requestView(overrides: Partial<RefundRequestView> = {}): RefundRequestView {
  return {
    requestId: 'rr_abcdefghjkmn',
    orderNumber: 'WN-7K3P9Q',
    status: 'APPROVED',
    customerMessage: 'Hi Ada, your refund of $49.99 for Oxford shirt, blue is confirmed.',
    approvedAmountMinor: 4999,
    lines: [{ itemName: 'Oxford shirt, blue', quantity: 1, outcome: 'REFUNDED' }],
    createdAt: '2026-09-28T10:05:00Z',
    ...overrides,
  }
}

/** A signed-in customer with one order, no earlier requests and the given conversation. */
export function customerApi(current: Conversation, requests: RefundRequestView[] = []) {
  server.use(
    http.get(url('/customer/orders'), () => json({ orders: [order] })),
    http.get(url('/customer/refund-requests'), () => json(requests)),
    http.post(url('/customer/conversations'), () => json(current, 201)),
    http.get(url('/customer/conversations/:id'), () => json(current)),
  )
}

export const metrics: AdminMetrics = {
  generatedAt: '2026-09-28T10:00:00Z',
  requests: { total: 3, last24Hours: 1, processing: 0, approved: 1, denied: 1, escalated: 1, awaitingReview: 1 },
  resolutions: { approved: 0, partiallyApproved: 0, denied: 0 },
  topEscalationReasons: [{ reason: 'NO_AI_ASSESSMENT', count: 1 }],
  stuckProcessingCount: 0,
  ai: { status: 'ok', provider: 'anthropic', model: 'claude-haiku', lastError: null },
}

export const queueRow: QueueRow = {
  requestId: 'rr_kemi00000001',
  createdAt: '2026-09-28T09:00:00Z',
  source: 'CUSTOMER',
  customerName: 'Kemi Adeyemi',
  customerEmail: 'customer+11@example.test',
  orderNumber: 'WN-3VH9TL',
  reason: 'CHANGED_MIND',
  requestedAmountMinor: 6500,
  status: 'ESCALATED',
  approvedAmountMinor: 0,
  reasons: ['NO_AI_ASSESSMENT'],
  resolution: null,
}

const line = (lineId: string, itemName: string, amountMinor: number): CaseBrief['lines'][number] => ({
  lineId,
  itemName,
  sku: lineId.toUpperCase(),
  finalSale: false,
  quantity: 1,
  amountMinor,
  lineOutcome: 'ALLOW',
  decidingRuleId: 'CHANGE_OF_MIND_ELIGIBLE',
  publicReason: null,
  finalLineStatus: 'UNDER_REVIEW',
})

export const caseBrief: CaseBrief = {
  request: { requestId: queueRow.requestId, source: 'CUSTOMER', state: 'DECIDED', createdAt: queueRow.createdAt, attempts: 1, reasonConfirmed: 'CHANGED_MIND', reasonOverridden: false },
  customer: { name: 'Kemi Adeyemi', email: 'customer+11@example.test' },
  order: { orderNumber: 'WN-3VH9TL', placedAt: '2026-09-18T10:00:00Z', deliveredAt: '2026-09-21T10:00:00Z', currency: 'USD' },
  lines: [line('line-shirt', 'Polo shirt, green', 4000), line('line-belt', 'Canvas belt, navy', 2500)],
  decision: {
    status: 'ESCALATED',
    approvedAmountMinor: 0,
    escalationReasons: ['NO_AI_ASSESSMENT'],
    customerMessage: "Thanks for your patience. We're taking a closer look at your request.",
    messageSource: 'TEMPLATE',
    policyVersion: '2026.09-1',
    gateResult: { policyStatus: 'APPROVED', reasons: ['NO_AI_ASSESSMENT'], assessment: 'MANUAL' },
    ruleTrace: null,
    decidedAt: '2026-09-28T09:00:05Z',
  },
  resolution: null,
  conversation: null,
  claim: { proposed: null, confirmed: { reason: 'CHANGED_MIND', lines: [{ itemName: 'Polo shirt, green', quantity: 1 }, { itemName: 'Canvas belt, navy', quantity: 1 }] }, reasonOverridden: false, itemsNotDiscussed: [] },
  aiSummary: null,
  aiSummarySuppressed: false,
  aiCalls: [],
  audit: [],
}

export const customerRow: CustomerRow = {
  customerId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  name: 'Femi Johnson',
  email: 'customer+6@example.test',
  orders: 1,
  requests: 2,
  openRequests: 1,
  refundedMinor: 30000,
}

export const customerDetail: CustomerDetail = {
  customer: { customerId: customerRow.customerId, name: 'Femi Johnson', email: 'customer+6@example.test', createdAt: '2026-09-01T10:00:00Z' },
  orders: [
    {
      orderNumber: 'WN-8NF4QA',
      placedAt: '2026-09-18T10:00:00Z',
      deliveredAt: '2026-09-21T10:00:00Z',
      currency: 'USD',
      totalMinor: 58000,
      refundedMinor: 30000,
      items: [
        { name: 'Ergonomic office chair', sku: 'CHAIR', quantity: 1, unitPricePaidMinor: 30000, finalSale: false, refundedQuantity: 1, pendingQuantity: 0 },
        { name: 'Standing desk mat, XL', sku: 'MAT', quantity: 1, unitPricePaidMinor: 28000, finalSale: false, refundedQuantity: 0, pendingQuantity: 1 },
      ],
    },
  ],
  requests: [
    { requestId: 'rr_femi0mat0001', orderNumber: 'WN-8NF4QA', createdAt: '2026-09-28T10:00:00Z', reason: 'DAMAGED', status: 'ESCALATED', resolution: null, requestedAmountMinor: 28000, approvedAmountMinor: 0 },
    { requestId: 'rr_6fem0chr0001', orderNumber: 'WN-8NF4QA', createdAt: '2026-09-22T10:00:00Z', reason: 'DAMAGED', status: 'APPROVED', resolution: null, requestedAmountMinor: 30000, approvedAmountMinor: 30000 },
  ],
  totals: { orderedMinor: 58000, refundedMinor: 30000 },
}
