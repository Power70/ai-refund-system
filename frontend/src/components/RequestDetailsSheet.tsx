import type { RefundRequestView } from '../api/client'
import { formatDate } from '../lib/format'
import { RequestOutcome } from './DecisionCard'
import { StatusBadge } from './StatusBadge'
import { Sheet } from './ui'

interface RequestDetailsSheetProps {
  request: RefundRequestView
  currency?: string
  onClose: () => void
}

/** One of the customer's refund requests, with the latest outcome (including a reviewer's). */
export function RequestDetailsSheet({ request, currency, onClose }: RequestDetailsSheetProps) {
  return (
    <Sheet
      labelledBy="request-heading"
      onClose={onClose}
      title={
        <>
          <h2 id="request-heading" className="font-semibold">
            Refund request <span className="font-mono text-sm font-normal text-slate-500">{request.requestId}</span>
          </h2>
          <p className="text-xs text-slate-500">
            Order <span className="font-mono">{request.orderNumber}</span> · submitted {formatDate(request.createdAt)}
          </p>
        </>
      }
    >
      <section aria-label="Outcome" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <StatusBadge status={request.status} />
        <RequestOutcome request={request} currency={currency} />
      </section>
    </Sheet>
  )
}
