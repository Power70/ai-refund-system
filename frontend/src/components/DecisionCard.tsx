import { IconCircleCheck, IconCircleX, IconClockHour4 } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import type { RefundRequestView } from '../api/client'
import { formatMoney } from '../lib/format'
import { StatusBadge } from './StatusBadge'
import { ChatCard, Spinner } from './ui'

const LINE_OUTCOMES: Record<RefundRequestView['lines'][number]['outcome'], { icon: ReactNode; label: string }> = {
  REFUNDED: { icon: <IconCircleCheck size={16} className="text-emerald-600" aria-hidden="true" />, label: 'Refunded' },
  NOT_REFUNDED: { icon: <IconCircleX size={16} className="text-rose-600" aria-hidden="true" />, label: 'Not refunded' },
  UNDER_REVIEW: { icon: <IconClockHour4 size={16} className="text-amber-600" aria-hidden="true" />, label: 'In review' },
  PROCESSING: { icon: <Spinner className="text-slate-500" />, label: 'Processing' },
}

export function DecisionCard({ request, currency }: { request: RefundRequestView; currency?: string }) {
  return (
    <ChatCard labelledBy="decision-heading" focusKey={request.status}>
      <div className="flex items-center justify-between gap-2">
        <h3 id="decision-heading" className="font-semibold">
          Refund request <span className="font-mono text-sm font-normal text-slate-500">{request.requestId}</span>
        </h3>
        <StatusBadge status={request.status} />
      </div>

      <p className="mt-3 text-sm whitespace-pre-wrap text-slate-800" aria-live="polite">
        {request.status === 'PROCESSING' ? "We're checking your request. This usually takes a few seconds." : request.customerMessage}
      </p>

      <ul className="mt-3 space-y-1.5">
        {request.lines.map((line) => (
          <li key={line.itemName} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {line.quantity} × {line.itemName}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-slate-600">
              {LINE_OUTCOMES[line.outcome].icon} {LINE_OUTCOMES[line.outcome].label}
            </span>
          </li>
        ))}
      </ul>

      {request.approvedAmountMinor > 0 && (
        <p className="mt-3 border-t border-slate-100 pt-3 text-sm">
          Refund amount: <span className="font-semibold">{formatMoney(request.approvedAmountMinor, currency)}</span>
        </p>
      )}
    </ChatCard>
  )
}
