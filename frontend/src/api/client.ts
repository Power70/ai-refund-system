export type RefundReason = 'DAMAGED' | 'WRONG_ITEM' | 'NOT_AS_DESCRIBED' | 'CHANGED_MIND' | 'OTHER'
export type RequestStatus = 'PROCESSING' | 'APPROVED' | 'DENIED' | 'ESCALATED'
export type HealthStatus = 'ok' | 'degraded'

export interface OrderItem {
  id: string
  name: string
  quantity: number
  unitPricePaidMinor: number
  finalSale: boolean
  refundedQuantity: number
  pendingQuantity: number
  refundableQuantity: number
}

export interface Order {
  orderNumber: string
  placedAt: string
  deliveredAt: string | null
  currency: string
  items: OrderItem[]
}

export interface ChatMessage {
  id: string
  role: 'CUSTOMER' | 'ASSISTANT'
  text: string
  createdAt: string
}

export type QuickReply =
  | { kind: 'ITEM'; label: string; orderItemId: string }
  | { kind: 'REASON'; label: string; reason: RefundReason }
  | { kind: 'YES_NO'; label: string; value: boolean }

export interface ProposalLine {
  orderItemId: string
  itemName: string
  quantity: number
  maxQuantity: number
}

export interface Proposal {
  orderId: string
  orderNumber: string
  reason: RefundReason
  lines: ProposalLine[]
}

export interface Conversation {
  conversationId: string
  state: 'ACTIVE' | 'SUBMITTED' | 'CLOSED'
  mode: 'AI' | 'MANUAL'
  requestId: string | null
  messages: ChatMessage[]
  quickReplies: QuickReply[]
  proposal: Proposal | null
  /** Reasons with display labels, as the server defines them. */
  reasons: { reason: RefundReason; label: string }[]
}

export interface RefundRequestView {
  requestId: string
  orderNumber: string
  status: RequestStatus
  customerMessage: string | null
  approvedAmountMinor: number
  lines: { itemName: string; quantity: number; outcome: 'REFUNDED' | 'NOT_REFUNDED' | 'UNDER_REVIEW' | 'PROCESSING' }[]
  createdAt: string
}

export interface ClaimSubmission {
  orderNumber: string
  reason: RefundReason
  lines: { itemId: string; quantity: number }[]
  conversationId: string
}

export type ChatInput = { text: string } | { orderItemId: string } | { reason: RefundReason } | { answer: boolean }

/** An API error with the server's stable code (when present) and a message fit for the UI. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const BASE = '/api/v1'
// Required by the API on every state-changing request (CSRF defence).
const CSRF = { 'X-Requested-With': 'refund-app' }

async function request<T>(method: string, path: string, options: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      signal: options.signal,
      headers: {
        Accept: 'application/json',
        ...(method === 'GET' ? {} : CSRF),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'NETWORK', "We couldn't reach the server. Check your connection and try again.")
  }
  if (res.status === 204) return undefined as T
  const body = (await res.json().catch(() => null)) as { code?: string; message?: string | string[] } | null
  if (!res.ok) {
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message
    throw new ApiError(res.status, body?.code ?? null, message ?? `Request failed (${res.status}).`)
  }
  return body as T
}

export const api = {
  health: async (signal?: AbortSignal): Promise<HealthStatus> => {
    try {
      return (await request<{ status: HealthStatus }>('GET', '/health', { signal })).status
    } catch (error) {
      // 503 means the API is up but a dependency is not.
      if (error instanceof ApiError && error.status === 503) return 'degraded'
      throw error
    }
  },

  signIn: (email: string, orderNumber: string) => request<{ firstName: string }>('POST', '/customer/session', { body: { email, orderNumber } }),
  currentSession: () => request<{ firstName: string }>('GET', '/customer/session'),
  signOut: () => request<void>('DELETE', '/customer/session'),

  orders: async () => (await request<{ orders: Order[] }>('GET', '/customer/orders')).orders,

  startConversation: () => request<Conversation>('POST', '/customer/conversations'),
  conversation: (id: string) => request<Conversation>('GET', `/customer/conversations/${id}`),
  sendMessage: (id: string, clientMessageId: string, input: ChatInput) =>
    request<Conversation>('POST', `/customer/conversations/${id}/messages`, { body: { clientMessageId, ...input } }),

  submitClaim: (claim: ClaimSubmission, idempotencyKey: string) =>
    request<RefundRequestView>('POST', '/customer/refund-requests', { body: claim, headers: { 'Idempotency-Key': idempotencyKey } }),
  refundRequest: (requestId: string) => request<RefundRequestView>('GET', `/customer/refund-requests/${requestId}`),
  refundRequests: () => request<RefundRequestView[]>('GET', '/customer/refund-requests'),
}
