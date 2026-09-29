export type RefundReason = 'DAMAGED' | 'WRONG_ITEM' | 'NOT_AS_DESCRIBED' | 'CHANGED_MIND' | 'OTHER'
export type RequestStatus = 'PROCESSING' | 'APPROVED' | 'DENIED' | 'ESCALATED'
/** What the customer sees: an approval that left some items unrefunded is partial. */
export type CustomerRequestStatus = RequestStatus | 'PARTIALLY_APPROVED'
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
  status: CustomerRequestStatus
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

// ---------------------------------------------------------------------------
// Support dashboard (Bearer admin token, kept in memory only)

export type ResolutionOutcome = 'APPROVED' | 'PARTIALLY_APPROVED' | 'DENIED'
export type QueueView = 'needs-review' | 'all'

export interface QueueQuery {
  view: QueueView
  status?: RequestStatus
  q?: string
  page: number
  pageSize: number
}

export interface QueueRow {
  requestId: string
  createdAt: string
  source: 'CUSTOMER' | 'SEED'
  customerName: string
  customerEmail: string
  orderNumber: string
  reason: RefundReason
  requestedAmountMinor: number
  status: RequestStatus
  approvedAmountMinor: number
  reasons: string[]
  resolution: ResolutionOutcome | null
}

export interface AiStatus {
  status: 'ok' | 'degraded' | 'disabled'
  provider: string | null
  model: string | null
  lastError: string | null
}

export interface AdminMetrics {
  generatedAt: string
  requests: { total: number; last24Hours: number; processing: number; approved: number; denied: number; escalated: number; awaitingReview: number }
  resolutions: { approved: number; partiallyApproved: number; denied: number }
  topEscalationReasons: { reason: string; count: number }[]
  stuckProcessingCount: number
  ai: AiStatus
}

export interface ConversationFlags {
  injectionAttempt: boolean
  mentionsOtherCustomerOrder: boolean
  abusive: boolean
  offTopic: boolean
}

interface ClaimSide {
  reason: RefundReason
  lines: { itemName: string; quantity: number }[]
}

export interface CaseBrief {
  request: { requestId: string; source: string; state: string; createdAt: string; attempts: number; reasonConfirmed: RefundReason; reasonOverridden: boolean }
  customer: { name: string; email: string }
  order: { orderNumber: string; placedAt: string; deliveredAt: string | null; currency: string }
  lines: {
    lineId: string
    itemName: string
    sku: string
    finalSale: boolean
    quantity: number
    amountMinor: number
    lineOutcome: 'ALLOW' | 'DENY' | 'REVIEW' | null
    decidingRuleId: string | null
    publicReason: string | null
    finalLineStatus: 'REFUNDED' | 'NOT_REFUNDED' | 'UNDER_REVIEW' | null
  }[]
  decision: {
    status: RequestStatus
    approvedAmountMinor: number
    escalationReasons: string[]
    customerMessage: string
    messageSource: 'AI' | 'TEMPLATE'
    policyVersion: string
    gateResult: { policyStatus?: RequestStatus; reasons?: string[]; assessment?: string } | null
    ruleTrace: unknown
    decidedAt: string
  } | null
  resolution: {
    outcome: ResolutionOutcome
    approvedAmountMinor: number
    reviewerNote: string
    customerMessage: string
    lines: { lineId: string; itemName: string; approve: boolean }[]
    resolvedAt: string
  } | null
  conversation: {
    conversationId: string
    mode: 'AI' | 'MANUAL'
    handoverReason: string | null
    flags: ConversationFlags
    priorFlaggedConversation: boolean
    transcript: { role: 'CUSTOMER' | 'ASSISTANT'; text: string; typed: boolean; at: string }[]
    evidenceQuotes: string[]
  } | null
  claim: { proposed: (ClaimSide & { confidence: number }) | null; confirmed: ClaimSide; reasonOverridden: boolean; itemsNotDiscussed: string[] }
  aiSummary: { summary: string; suggestedAction: 'APPROVE' | 'DENY' | 'NEEDS_INFO'; rationale: string } | null
  aiSummarySuppressed: boolean
  aiCalls: { kind: string; provider: string | null; model: string | null; outcome: string; attempts: number; latencyMs: number; inputTokens: number | null; outputTokens: number | null; at: string }[]
  audit: { type: string; actor: string; data: unknown; correlationId: string | null; at: string }[]
}

export function adminApi(token: string) {
  const auth = { Authorization: `Bearer ${token}` }
  return {
    metrics: () => request<AdminMetrics>('GET', '/admin/metrics', { headers: auth }),
    queue: (query: QueueQuery) => {
      const params = new URLSearchParams({ view: query.view, page: String(query.page), pageSize: String(query.pageSize) })
      if (query.status) params.set('status', query.status)
      if (query.q) params.set('q', query.q)
      return request<{ items: QueueRow[]; total: number; page: number; pageSize: number }>('GET', `/admin/refund-requests?${params}`, { headers: auth })
    },
    caseBrief: (requestId: string) => request<CaseBrief>('GET', `/admin/refund-requests/${requestId}`, { headers: auth }),
    resolve: (requestId: string, lineDecisions: { lineId: string; approve: boolean }[], reviewerNote: string) =>
      request<CaseBrief>('POST', `/admin/refund-requests/${requestId}/resolution`, { headers: auth, body: { lineDecisions, reviewerNote } }),
  }
}

export type AdminApi = ReturnType<typeof adminApi>
